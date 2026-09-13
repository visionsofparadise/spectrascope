import {
	createDisplayTileRequests,
	displayTileBytes,
	displayTileWork,
	retainDisplayTile,
	releaseDisplayTile,
} from "./runDisplayPipeline";
import type { DisplayTileRequest } from "./runDisplayPipeline";
import type { PipelineOptions, PipelineResult } from "./runPipeline";
import type { SharedWorkLease } from "../utils/SharedWorkCache";

interface DisplayTileSnapshot {
	readonly key: string;
	readonly startSample: number;
	readonly endSample: number;
	readonly displayEndSample: number;
	readonly width: number;
	readonly height: number;
	readonly waveform: PipelineResult | null;
	readonly spectrogram: PipelineResult | null;
}

export interface DisplayTileStoreSnapshot {
	readonly status: "idle" | "computing" | "ready" | "error";
	readonly progress: number;
	readonly tiles: ReadonlyArray<DisplayTileSnapshot>;
	readonly retainedTiles: ReadonlyArray<DisplayTileSnapshot>;
	readonly error?: Error;
}

interface Entry {
	readonly request: DisplayTileRequest;
	readonly controller: AbortController;
	waveform: SharedWorkLease<PipelineResult> | undefined;
	spectrogram: SharedWorkLease<PipelineResult> | undefined;
	error?: Error;
}

class WorkQueue {
	private active = 0;
	private readonly waiting: Array<() => void> = [];
	constructor(private readonly limit: number) {}

	async run<T>(signal: AbortSignal, compute: () => Promise<T>): Promise<T> {
		await new Promise<void>((resolve, reject) => {
			const abort = () => {
				const index = this.waiting.indexOf(start);

				if (index >= 0) this.waiting.splice(index, 1);

				reject(new DOMException("Work cancelled", "AbortError"));
			};
			const start = () => {
				signal.removeEventListener("abort", abort);
				this.active++;
				resolve();
			};

			if (signal.aborted) {
				reject(new DOMException("Work cancelled", "AbortError"));

				return;
			}

			if (this.active < this.limit) start();
			else {
				this.waiting.push(start);
				signal.addEventListener("abort", abort, { once: true });
			}
		});

		try {
			signal.throwIfAborted();

			return await compute();
		} finally {
			this.active--;
			this.waiting.shift()?.();
		}
	}
}

const waveformQueue = new WorkQueue(2);
const spectrogramQueue = new WorkQueue(1);

function release(entry: Entry): void {
	entry.controller.abort();
	entry.waveform?.release();
	entry.spectrogram?.release();
}

function snapshotOf(entry: Entry): DisplayTileSnapshot {
	const { request } = entry;

	return {
		key: request.key,
		...request.options.sampleQuery,
		displayEndSample: request.displayEndSample,
		waveform: entry.waveform?.value ?? null,
		spectrogram: entry.spectrogram?.value ?? null,
	};
}

export class DisplayTileStore {
	private entries: Array<Entry> = [];
	private retained: Array<Entry> = [];
	private readonly listeners = new Set<() => void>();
	private snapshot: DisplayTileStoreSnapshot = { status: "idle", progress: 0, tiles: [], retainedTiles: [] };
	private disposed = false;
	private options: PipelineOptions | undefined;
	private detachSignal: (() => void) | undefined;

	readonly getSnapshot = (): DisplayTileStoreSnapshot => this.snapshot;
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);

		return () => this.listeners.delete(listener);
	};

	update(options: PipelineOptions): void {
		if (this.disposed) return;

		this.detachSignal?.();

		const signal = options.config.signal;
		const abort = () =>
			queueMicrotask(() => {
				if (this.options !== options || this.disposed) return;

				for (const entry of [...this.entries, ...this.retained]) release(entry);

				this.entries = [];
				this.retained = [];
				this.publish();
			});

		signal.addEventListener("abort", abort, { once: true });
		this.detachSignal = () => signal.removeEventListener("abort", abort);

		const previous = this.entries;
		const compatible =
			this.options?.readSamples === options.readSamples &&
			JSON.stringify([this.options.metadata, this.options.config.channelInput]) ===
				JSON.stringify([options.metadata, options.config.channelInput]);

		this.options = options;

		const requests =
			signal.aborted ||
			options.sampleQuery.endSample <= options.sampleQuery.startSample ||
			options.sampleQuery.width <= 0 ||
			options.sampleQuery.height <= 0 ||
			options.metadata.channelCount <= 0
				? []
				: createDisplayTileRequests(options);

		this.entries = requests.map((request) => {
			const existing = previous.find(
				(entry) => !entry.error && entry.request.owner === request.owner && entry.request.key === request.key,
			);

			if (existing) return existing;

			const entry: Entry = {
				request,
				controller: new AbortController(),
				waveform: displayTileWork.get(request.owner, request.waveformKey),
				spectrogram: request.spectrogramKey
					? displayTileWork.get(request.owner, request.spectrogramKey)
					: undefined,
			};

			this.start(entry);

			return entry;
		});

		const candidates = [...previous, ...this.retained];
		const retainedKeys = new Set(this.entries.map((entry) => entry.request.key));
		let retainedBytes = 0;

		this.retained = [];

		for (const entry of candidates) {
			if (this.entries.includes(entry)) continue;

			entry.controller.abort();

			const bytes =
				(entry.waveform ? displayTileBytes(entry.waveform.value) : 0) +
				(entry.spectrogram ? displayTileBytes(entry.spectrogram.value) : 0);

			if (
				compatible &&
				!retainedKeys.has(entry.request.key) &&
				(entry.waveform || entry.spectrogram) &&
				entry.request.displayEndSample > options.sampleQuery.startSample &&
				entry.request.options.sampleQuery.startSample < options.sampleQuery.endSample &&
				this.retained.length < 256 &&
				retainedBytes + bytes <= 128 * 1024 * 1024
			) {
				this.retained.push(entry);
				retainedBytes += bytes;
				retainedKeys.add(entry.request.key);
			} else release(entry);
		}

		this.publish();
	}

	dispose(): void {
		if (this.disposed) return;

		this.disposed = true;
		this.detachSignal?.();

		for (const entry of [...this.entries, ...this.retained]) release(entry);

		this.entries = [];
		this.retained = [];
		this.listeners.clear();
	}

	private start(entry: Entry): void {
		const { request, controller } = entry;
		const load = async (waveformOnly: boolean): Promise<void> => {
			const key = waveformOnly ? request.waveformKey : request.spectrogramKey;

			if (!key || (waveformOnly ? entry.waveform : entry.spectrogram)) return;

			const lease = await displayTileWork.run(
				request.owner,
				key,
				controller.signal,
				(signal) =>
					(waveformOnly ? waveformQueue : spectrogramQueue).run(signal, async () => {
						const result = await request.compute(signal, waveformOnly);

						return retainDisplayTile(result);
					}),
				displayTileBytes,
				releaseDisplayTile,
			);

			if (controller.signal.aborted) {
				lease.release();

				return;
			}

			if (waveformOnly) entry.waveform = lease;
			else entry.spectrogram = lease;

			this.publish();
		};

		void load(true)
			.then(() => {
				controller.signal.throwIfAborted();

				return load(false);
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;

				entry.error = error instanceof Error ? error : new Error(String(error));
				this.publish();
			});
	}

	private publish(): void {
		if (this.disposed) return;

		const count = this.entries.reduce((total, entry) => total + (entry.request.spectrogramKey ? 2 : 1), 0);
		const done = this.entries.reduce(
			(total, entry) => total + Number(Boolean(entry.waveform)) + Number(Boolean(entry.spectrogram)),
			0,
		);
		const error = this.entries.find((entry) => entry.error)?.error;
		const ready = done === count;

		if (ready) {
			for (const entry of this.retained) release(entry);

			this.retained = [];
		}

		this.snapshot = {
			status: count === 0 ? "idle" : error ? "error" : ready ? "ready" : "computing",
			progress: count === 0 ? 0 : done / count,
			tiles: this.entries.map(snapshotOf),
			retainedTiles: [...this.retained].reverse().map(snapshotOf),
			...(error ? { error } : {}),
		};

		for (const listener of this.listeners) listener();
	}
}
