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

/** Largest number of cached transcodes kept before LRU eviction. */
const MAX_CACHE_ENTRIES = 32;

/** Content-identity + target-rate cache key: a transcode is uniquely determined by these. */
export const computeCacheKey = (filePath: string, size: number, mtimeMs: number, targetSampleRate: number): string => {
	const hash = crypto.createHash("sha256");

	hash.update(filePath);
	hash.update(`size:${String(size)}`);
	hash.update(`mtime:${String(mtimeMs)}`);
	hash.update(`rate:${String(targetSampleRate)}`);

	return hash.digest("hex");
};

/**
 * A source passes through (streams directly, no transcode) when it is already
 * PCM WAV at the target rate. A non-null header means `parseWavHeader` accepted
 * it, which it only does for supported PCM int/float WAV.
 */
export const shouldPassThrough = (header: WavHeader | null, targetSampleRate: number): boolean =>
	header !== null && header.sampleRate === targetSampleRate;

/**
 * Moves `hash` to most-recently-used and evicts the least-recently-used entries
 * beyond `maxEntries`, calling `onEvict` with each evicted file path.
 */
export const touchLru = (
	cache: Map<string, string>,
	hash: string,
	filePath: string,
	maxEntries: number,
	onEvict: (path: string) => void,
): void => {
	cache.delete(hash);
	cache.set(hash, filePath);

	while (cache.size > maxEntries) {
		const oldest = cache.keys().next();

		if (oldest.done === true) break;

		const evictedPath = cache.get(oldest.value);

		cache.delete(oldest.value);

		if (evictedPath !== undefined) onEvict(evictedPath);
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

/**
 * Prepares a source for streaming: a PCM WAV already at the canonical rate
 * passes through unchanged; anything else transcodes once via ffmpeg into a
 * bounded LRU cache under `<userData>/source-cache/`, keyed by content identity
 * plus target rate: hash-as-filename dedup, in-flight job tracking, atomic
 * `.partial`-then-rename writes, disposed on window close.
 */
export class SourceCacheManager {
	private readonly cacheDirectory: string;
	private readonly cache = new Map<string, string>();
	private readonly inFlight = new Map<string, InFlightJob>();
	private disposed = false;

	constructor(userDataPath: string) {
		this.cacheDirectory = path.join(userDataPath, "source-cache");

		fs.mkdirSync(this.cacheDirectory, { recursive: true });
	}

	async prepare(filePath: string, targetSampleRate: number): Promise<PreparedSource> {
		if (this.disposed) throw new Error("SourceCacheManager has been disposed");

		const probe = await probeAudioFile(filePath);
		const nativeSampleRate = probe.sampleRate;

		const passthroughHeader = await this.tryParsePassthrough(filePath, targetSampleRate);

		if (passthroughHeader !== null) return buildPrepared(filePath, passthroughHeader, nativeSampleRate);

		const pcmPath = await this.ensureTranscoded(filePath, targetSampleRate);
		const handle = await fsPromises.open(pcmPath, "r");

		try {
			const header = await parseWavHeader(handle);

			return buildPrepared(pcmPath, header, nativeSampleRate);
		} finally {
			await handle.close();
		}
	}

	/** Aborts every in-flight transcode and removes the cache directory. */
	dispose(): void {
		this.disposed = true;

		for (const job of this.inFlight.values()) {
			job.controller.abort();
		}

		this.inFlight.clear();
		this.cache.clear();

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

	private async ensureTranscoded(filePath: string, targetSampleRate: number): Promise<string> {
		const stats = await fsPromises.stat(filePath);
		const hash = computeCacheKey(filePath, stats.size, stats.mtimeMs, targetSampleRate);
		const outputPath = path.join(this.cacheDirectory, `${hash}.wav`);

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

		if (existingJob !== undefined) return existingJob.promise;

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

		return promise;
	}

	/**
	 * Transcodes to canonical-rate `pcm_f32le`, keeping the native channel count
	 * (no `-ac`). Writes to a `.partial` temp path so an aborted run never strands
	 * a truncated file, then atomically renames on a clean exit. `-f wav` is
	 * required because the `.partial` extension gives ffmpeg no format to infer.
	 */
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
		touchLru(this.cache, hash, filePath, MAX_CACHE_ENTRIES, (evictedPath) => {
			fs.rmSync(evictedPath, { force: true });
		});
	}
}
