import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import { resolveStream, type ResolvedStream, type StreamSpec } from "./audio/streamDsp";

export interface StreamInfo {
	readonly key: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly totalFrames: number;
	readonly durationMs: number;
}

const MAX_STREAM_ENTRIES = 32;

const toStreamInfo = (key: string, resolved: ResolvedStream): StreamInfo => ({
	key,
	sampleRate: resolved.sampleRate,
	channelCount: resolved.outputChannels,
	totalFrames: resolved.totalFrames,
	durationMs: (resolved.totalFrames / resolved.sampleRate) * 1000,
});

const closeHandles = (resolved: ResolvedStream): void => {
	for (const input of resolved.inputs) {
		void input.fileHandle.close().catch(() => undefined);
	}
};

export class StreamManager {
	private readonly cache = new Map<string, ResolvedStream>();
	private readonly inFlight = new Map<string, Promise<ResolvedStream>>();
	private disposed = false;

	async registerStream(spec: StreamSpec): Promise<StreamInfo> {
		if (this.disposed) throw new Error("StreamManager has been disposed");

		const key = await this.computeKey(spec);
		const resolved = await this.resolveForKey(key, spec);

		return toStreamInfo(key, resolved);
	}

	get(key: string): ResolvedStream | undefined {
		const resolved = this.cache.get(key);

		if (resolved !== undefined) this.touch(key, resolved);

		return resolved;
	}

	dispose(): void {
		this.disposed = true;

		for (const resolved of this.cache.values()) closeHandles(resolved);

		this.cache.clear();
		this.inFlight.clear();
	}

	private async resolveForKey(key: string, spec: StreamSpec): Promise<ResolvedStream> {
		const cached = this.cache.get(key);

		if (cached !== undefined) {
			this.touch(key, cached);

			return cached;
		}

		const existing = this.inFlight.get(key);

		if (existing !== undefined) return existing;

		const promise = resolveStream(spec, (pcmPath) => fsPromises.open(pcmPath, "r"))
			.then((resolved) => {
				this.store(key, resolved);

				return resolved;
			})
			.finally(() => {
				this.inFlight.delete(key);
			});

		this.inFlight.set(key, promise);

		return promise;
	}

	private store(key: string, resolved: ResolvedStream): void {
		const previous = this.cache.get(key);

		if (previous !== undefined && previous !== resolved) closeHandles(previous);

		this.cache.set(key, resolved);

		while (this.cache.size > MAX_STREAM_ENTRIES) {
			const oldest = this.cache.keys().next();

			if (oldest.done === true) break;

			const evicted = this.cache.get(oldest.value);

			this.cache.delete(oldest.value);

			if (evicted !== undefined) closeHandles(evicted);
		}
	}

	private touch(key: string, resolved: ResolvedStream): void {
		this.cache.delete(key);
		this.cache.set(key, resolved);
	}

	private async computeKey(spec: StreamSpec): Promise<string> {
		const stats = await Promise.all(spec.inputs.map((input) => fsPromises.stat(input.pcmPath)));
		const hash = crypto.createHash("sha256");

		spec.inputs.forEach((input, index) => {
			const fileStats = stats[index];

			if (fileStats === undefined) throw new Error(`Missing file stats for stream input "${input.pcmPath}"`);

			hash.update(input.pcmPath);
			hash.update(`|size:${String(fileStats.size)}`);
			hash.update(`|mtime:${String(fileStats.mtimeMs)}`);
			hash.update(`|offset:${String(input.offsetMs)}`);
			hash.update(`|gain:${String(input.gain)}|`);
		});

		return hash.digest("hex");
	}
}
