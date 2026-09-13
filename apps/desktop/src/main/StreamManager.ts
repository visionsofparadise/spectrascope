import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import {
	closeResolvedStream,
	resolveStream,
	type PrepareStreamInput,
	type ResolvedStream,
	type StreamSpec,
} from "./audio/streamDsp";

export interface StreamInfo {
	readonly key: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly totalFrames: number;
	readonly durationMs: number;
}

const MAX_STREAM_ENTRIES = 32;

interface StreamEntry {
	readonly spec: StreamSpec;
	owners: number;
	requests: number;
}

export interface StreamLease {
	readonly resolved: ResolvedStream;
	readonly release: () => void;
}

const toStreamInfo = (key: string, resolved: ResolvedStream): StreamInfo => ({
	key,
	sampleRate: resolved.sampleRate,
	channelCount: resolved.outputChannels,
	totalFrames: resolved.totalFrames,
	durationMs: (resolved.totalFrames / resolved.sampleRate) * 1000,
});

const closeHandles = (resolved: ResolvedStream): void => {
	void closeResolvedStream(resolved).catch(() => undefined);
};

export class StreamManager {
	private readonly entries = new Map<string, StreamEntry>();
	private readonly cache = new Map<string, ResolvedStream>();
	private readonly inFlight = new Map<string, Promise<ResolvedStream>>();
	private disposed = false;
	private generation = 0;

	constructor(private readonly prepareInput?: PrepareStreamInput) {}

	async registerStream(spec: StreamSpec): Promise<StreamInfo> {
		this.assertActive();

		const generation = this.generation;

		const key = await this.computeKey(spec);

		this.assertActive();

		if (generation !== this.generation) throw new Error("Stream registration was reset");

		let entry = this.entries.get(key);

		if (!entry) {
			entry = { spec, owners: 0, requests: 0 };
			this.entries.set(key, entry);
		}

		entry.owners++;

		try {
			const lease = await this.acquire(key);

			if (!lease) throw new Error("Stream registration was released");

			const info = toStreamInfo(key, lease.resolved);

			lease.release();

			if (generation !== this.generation) throw new Error("Stream registration was reset");

			return info;
		} catch (error) {
			if (generation === this.generation) this.releaseStream(key);

			throw error;
		}
	}

	releaseStream(key: string): void {
		const entry = this.entries.get(key);

		if (!entry) return;

		entry.owners = Math.max(0, entry.owners - 1);
		this.releaseUnused(key, entry);
	}

	usesPath(pcmPath: string): boolean {
		return (
			[...this.entries.values()].some((entry) => entry.spec.inputs.some((input) => input.pcmPath === pcmPath)) ||
			[...this.cache.values()].some((resolved) => resolved.inputs.some((input) => input.pcmPath === pcmPath))
		);
	}

	async acquire(key: string): Promise<StreamLease | undefined> {
		if (this.disposed) return undefined;

		const entry = this.entries.get(key);

		if (!entry) return undefined;

		entry.requests++;

		let released = false;
		const release = (): void => {
			if (released) return;

			released = true;
			entry.requests--;
			this.releaseUnused(key, entry);
			this.evictIdle();
		};

		try {
			return { resolved: await this.resolveForKey(key, entry.spec), release };
		} catch (error) {
			release();

			throw error;
		}
	}

	dispose(): void {
		this.disposed = true;

		for (const resolved of this.cache.values()) closeHandles(resolved);

		this.cache.clear();
		this.inFlight.clear();
		this.entries.clear();
	}

	reset(): void {
		this.generation++;

		for (const [key, entry] of this.entries) {
			entry.owners = 0;
			this.releaseUnused(key, entry);
		}
	}

	private releaseUnused(key: string, entry: StreamEntry): void {
		if (entry.owners > 0 || entry.requests > 0) return;

		if (this.entries.get(key) !== entry) return;

		this.entries.delete(key);

		const resolved = this.cache.get(key);

		this.cache.delete(key);

		if (resolved) closeHandles(resolved);
	}

	private assertActive(): void {
		if (this.disposed) throw new Error("StreamManager has been disposed");
	}

	private async resolveForKey(key: string, spec: StreamSpec): Promise<ResolvedStream> {
		const cached = this.cache.get(key);

		if (cached !== undefined) {
			this.touch(key, cached);

			return cached;
		}

		const existing = this.inFlight.get(key);

		if (existing !== undefined) return existing;

		const promise = resolveStream(spec, (pcmPath) => fsPromises.open(pcmPath, "r"), this.prepareInput)
			.then((resolved) => {
				if (this.disposed) {
					closeHandles(resolved);

					throw new Error("StreamManager has been disposed");
				}

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
		this.evictIdle();
	}

	private evictIdle(): void {
		const idle = [...this.cache.keys()].filter((key) => (this.entries.get(key)?.requests ?? 0) === 0);

		for (const key of idle.slice(0, Math.max(0, idle.length - MAX_STREAM_ENTRIES))) {
			const evicted = this.cache.get(key);

			this.cache.delete(key);

			if (evicted) closeHandles(evicted);
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
