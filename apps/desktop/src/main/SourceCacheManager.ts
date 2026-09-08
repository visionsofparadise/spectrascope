import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { probeAudioFile } from "./audio/probe";
import { parseWavHeader, type WavHeader } from "./audio/wavReader";
import { getFfmpegPath } from "./ffmpeg/ffmpegPath";

export interface PreparedSource {
	readonly pcmPath: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly sampleCount: number;
	readonly nativeSampleRate: number;
	readonly durationMs: number;
}

const MAX_CACHE_ENTRIES = 32;

export const computeCacheKey = (filePath: string, size: number, mtimeMs: number, targetSampleRate: number): string => {
	const hash = crypto.createHash("sha256");

	hash.update(filePath);
	hash.update(`size:${String(size)}`);
	hash.update(`mtime:${String(mtimeMs)}`);
	hash.update(`rate:${String(targetSampleRate)}`);

	return hash.digest("hex");
};

export const shouldPassThrough = (header: WavHeader | null, targetSampleRate: number): boolean =>
	header !== null && header.sampleRate === targetSampleRate;

export const touchLru = (
	cache: Map<string, string>,
	hash: string,
	filePath: string,
	maxEntries: number,
	onEvict: (path: string) => void,
	isRetained: (path: string) => boolean = () => false,
): void => {
	cache.delete(hash);
	cache.set(hash, filePath);

	const idle = [...cache].filter(([, cachedPath]) => !isRetained(cachedPath));

	for (const [key, evictedPath] of idle.slice(0, Math.max(0, idle.length - maxEntries))) {
		onEvict(evictedPath);
		cache.delete(key);
	}
};

interface InFlightJob {
	readonly controller: AbortController;
	readonly promise: Promise<string>;
}

const buildPrepared = (pcmPath: string, header: WavHeader, nativeSampleRate: number): PreparedSource => ({
	pcmPath,
	sampleRate: header.sampleRate,
	channelCount: header.channelCount,
	sampleCount: header.frameCount,
	nativeSampleRate,
	durationMs: (header.frameCount / header.sampleRate) * 1000,
});

export class SourceCacheManager {
	private readonly cacheDirectory: string;
	private readonly cache = new Map<string, string>();
	private readonly inFlight = new Map<string, InFlightJob>();
	private readonly pins = new Map<string, number>();
	private disposed = false;
	private generation = 0;

	constructor(
		userDataPath: string,
		private readonly isRetained: (pcmPath: string) => boolean = () => false,
	) {
		this.cacheDirectory = path.join(userDataPath, "source-cache");

		fs.mkdirSync(this.cacheDirectory, { recursive: true });
	}

	async prepare(filePath: string, targetSampleRate: number): Promise<PreparedSource> {
		if (this.disposed) throw new Error("SourceCacheManager has been disposed");

		const generation = this.generation;

		const probe = await probeAudioFile(filePath);
		const nativeSampleRate = probe.sampleRate;

		const passthroughHeader = await this.tryParsePassthrough(filePath, targetSampleRate);

		this.assertGeneration(generation);

		if (passthroughHeader !== null) return buildPrepared(filePath, passthroughHeader, nativeSampleRate);

		const pcmPath = await this.ensureTranscoded(filePath, targetSampleRate, generation);

		try {
			const handle = await fsPromises.open(pcmPath, "r");

			try {
				const header = await parseWavHeader(handle);

				this.assertGeneration(generation);

				return buildPrepared(pcmPath, header, nativeSampleRate);
			} finally {
				await handle.close();
			}
		} catch (error) {
			if (generation === this.generation) this.releasePreparedSource(pcmPath);

			throw error;
		}
	}

	releasePreparedSource(pcmPath: string): void {
		const count = this.pins.get(pcmPath) ?? 0;

		if (count > 1) this.pins.set(pcmPath, count - 1);
		else this.pins.delete(pcmPath);

		this.trimIdle();
	}

	private trimIdle(): void {
		const cached = [...this.cache];
		const latest = cached[cached.length - 1];

		if (latest) this.touchCacheEntry(latest[0], latest[1]);
	}

	private assertGeneration(generation: number): void {
		if (this.disposed || generation !== this.generation) throw new Error("Source preparation was reset");
	}

	reset(): void {
		this.generation++;
		this.pins.clear();
		this.trimIdle();
	}

	dispose(): void {
		this.disposed = true;

		for (const job of this.inFlight.values()) {
			job.controller.abort();
		}

		this.inFlight.clear();
		this.cache.clear();
		this.pins.clear();

		fs.rmSync(this.cacheDirectory, { recursive: true, force: true });
	}

	private async tryParsePassthrough(filePath: string, targetSampleRate: number): Promise<WavHeader | null> {
		let handle: fsPromises.FileHandle | null = null;

		try {
			handle = await fsPromises.open(filePath, "r");

			const header = await parseWavHeader(handle);

			return shouldPassThrough(header, targetSampleRate) ? header : null;
		} catch {
			return null;
		} finally {
			if (handle !== null) await handle.close();
		}
	}

	private async ensureTranscoded(filePath: string, targetSampleRate: number, generation: number): Promise<string> {
		const stats = await fsPromises.stat(filePath);
		const hash = computeCacheKey(filePath, stats.size, stats.mtimeMs, targetSampleRate);
		const outputPath = path.join(this.cacheDirectory, `${hash}.wav`);

		if (this.disposed || generation !== this.generation) throw new Error("Source preparation was reset");

		this.pins.set(outputPath, (this.pins.get(outputPath) ?? 0) + 1);

		try {
			const cached = this.cache.get(hash);

			if (cached !== undefined && fs.existsSync(cached)) {
				this.touchCacheEntry(hash, cached);

				return cached;
			}

			if (this.cache.has(hash) && !fs.existsSync(outputPath)) {
				this.cache.delete(hash);
			} else if (fs.existsSync(outputPath)) {
				this.touchCacheEntry(hash, outputPath);

				return outputPath;
			}

			const existingJob = this.inFlight.get(hash);

			if (existingJob !== undefined) return await existingJob.promise;

			const controller = new AbortController();
			const promise = this.runFfmpeg(filePath, targetSampleRate, outputPath, controller.signal)
				.then(() => {
					this.touchCacheEntry(hash, outputPath);

					return outputPath;
				})
				.finally(() => {
					this.inFlight.delete(hash);
				});

			this.inFlight.set(hash, { controller, promise });

			return await promise;
		} catch (error) {
			if (generation === this.generation) this.releasePreparedSource(outputPath);

			throw error;
		}
	}

	private async runFfmpeg(
		filePath: string,
		targetSampleRate: number,
		outputPath: string,
		signal: AbortSignal,
	): Promise<void> {
		const tempPath = `${outputPath}.partial`;

		const args = [
			"-y",
			"-hide_banner",
			"-nostdin",
			"-i",
			filePath,
			"-map",
			"a:0",
			"-ar",
			String(targetSampleRate),
			"-c:a",
			"pcm_f32le",
			"-rf64",
			"auto",
			"-f",
			"wav",
			tempPath,
		];

		try {
			await new Promise<void>((resolve, reject) => {
				const child = spawn(getFfmpegPath(), args, { signal });

				let stderr = "";

				child.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});

				child.on("error", (error: Error) => {
					reject(error);
				});

				child.on("close", (code, childSignal) => {
					if (code === 0) {
						resolve();

						return;
					}

					if (childSignal !== null) {
						reject(new Error(`ffmpeg was terminated by signal ${childSignal}`));

						return;
					}

					reject(new Error(`ffmpeg exited with code ${String(code)}: ${stderr.trim()}`));
				});
			});
		} catch (error) {
			fs.rmSync(tempPath, { force: true });

			throw error;
		}

		fs.renameSync(tempPath, outputPath);
	}

	private touchCacheEntry(hash: string, filePath: string): void {
		touchLru(
			this.cache,
			hash,
			filePath,
			MAX_CACHE_ENTRIES,
			(evictedPath) => {
				fs.rmSync(evictedPath, { force: true });
			},
			(cachedPath) => this.pins.has(cachedPath) || this.isRetained(cachedPath),
		);
	}
}
