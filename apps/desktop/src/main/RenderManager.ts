import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { buildFfmpegArgs } from "./ffmpeg/filtergraph";
import { getFfmpegPath } from "./ffmpeg/ffmpegPath";
import type { RenderSpec } from "./ffmpeg/renderSpec";

/** Largest number of cached render artifacts kept before LRU eviction. */
const MAX_CACHE_ENTRIES = 32;

interface InFlightJob {
	readonly controller: AbortController;
	readonly promise: Promise<string>;
}

/**
 * Spawns ffmpeg to render Sum/Difference derived signals, keyed by a hash over
 * everything that determines the output. Modelled on `FileWatcherManager`:
 * constructed once per window, injected via `IpcHandlerDependencies`, and
 * disposed when the window closes.
 *
 * The hash *is* the cache filename (`<userData>/render-cache/<hash>.wav`), which
 * gives natural dedup: a render whose hash already has a file returns it
 * immediately. In-flight jobs are tracked so a concurrent request for the same
 * hash awaits the running job instead of spawning a duplicate. Each job carries
 * an `AbortController` so a superseded job can be cancelled by the caller.
 */
export class RenderManager {
	private readonly cacheDirectory: string;
	private readonly cache = new Map<string, string>();
	private readonly inFlight = new Map<string, InFlightJob>();
	private disposed = false;

	constructor(userDataPath: string) {
		this.cacheDirectory = path.join(userDataPath, "render-cache");

		fs.mkdirSync(this.cacheDirectory, { recursive: true });
	}

	/**
	 * Renders the derived signal described by `spec`, returning the absolute path
	 * to the resulting WAV. Returns a cached file immediately when one exists for
	 * the spec's hash; otherwise spawns ffmpeg and resolves on a clean exit.
	 */
	async render(spec: RenderSpec): Promise<string> {
		if (this.disposed) {
			throw new Error("RenderManager has been disposed");
		}

		const hash = await this.computeHash(spec);
		const outputPath = path.join(this.cacheDirectory, `${hash}.wav`);

		const cached = this.cache.get(hash);

		if (cached !== undefined && fs.existsSync(cached)) {
			this.touchCacheEntry(hash, cached);

			return cached;
		}

		if (this.cache.has(hash) && !fs.existsSync(outputPath)) {
			// Cache entry is stale (file removed externally); drop and re-render.
			this.cache.delete(hash);
		} else if (fs.existsSync(outputPath)) {
			this.touchCacheEntry(hash, outputPath);

			return outputPath;
		}

		const existingJob = this.inFlight.get(hash);

		if (existingJob !== undefined) {
			return existingJob.promise;
		}

		const controller = new AbortController();
		const promise = this.runFfmpeg(spec, outputPath, controller.signal)
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

	/** Aborts every in-flight job and clears the cache directory. */
	dispose(): void {
		this.disposed = true;

		for (const job of this.inFlight.values()) {
			job.controller.abort();
		}

		this.inFlight.clear();
		this.cache.clear();

		fs.rmSync(this.cacheDirectory, { recursive: true, force: true });
	}

	/**
	 * Computes the cache key. Identical to the design's hash contract: the
	 * operation, each input's file content identity (path + size + mtime, the
	 * fast path over a full content hash) and `offsetMs` in order, plus the
	 * difference reference index.
	 */
	private async computeHash(spec: RenderSpec): Promise<string> {
		const hash = crypto.createHash("sha256");

		hash.update(spec.operation);
		hash.update(`ref:${String(spec.referenceIndex)}`);

		for (const input of spec.inputs) {
			const stats = await fsPromises.stat(input.filePath);

			hash.update(input.filePath);
			hash.update(`size:${String(stats.size)}`);
			hash.update(`mtime:${String(stats.mtimeMs)}`);
			hash.update(`offset:${String(input.offsetMs)}`);
		}

		return hash.digest("hex");
	}

	/**
	 * Spawns ffmpeg, resolving on exit code 0 and rejecting with stderr otherwise.
	 *
	 * ffmpeg writes to a `.partial` temp path so a failed or aborted run never
	 * strands a truncated file at the final cache path. On a clean exit the temp
	 * file is atomically renamed into place; on any rejection it is deleted. This
	 * keeps the invariant that a file at `outputPath` is always a complete render.
	 */
	private async runFfmpeg(spec: RenderSpec, outputPath: string, signal: AbortSignal): Promise<void> {
		const tempPath = `${outputPath}.partial`;
		const args = buildFfmpegArgs(spec, tempPath);

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

	/** Records a cache entry as most-recently-used and evicts the oldest beyond the bound. */
	private touchCacheEntry(hash: string, filePath: string): void {
		this.cache.delete(hash);
		this.cache.set(hash, filePath);

		while (this.cache.size > MAX_CACHE_ENTRIES) {
			const oldest = this.cache.keys().next();

			if (oldest.done === true) break;

			const evictedPath = this.cache.get(oldest.value);

			this.cache.delete(oldest.value);

			if (evictedPath !== undefined) {
				fs.rmSync(evictedPath, { force: true });
			}
		}
	}
}
