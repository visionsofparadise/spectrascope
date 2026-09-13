import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayTileStore } from "./DisplayTileStore";
import { SpectralEngine, type SpectralProcessContext } from "./SpectralEngine";
import type { PipelineOptions } from "./runPipeline";

afterEach(() => vi.restoreAllMocks());

function fixture(): PipelineOptions {
	return {
		metadata: { sampleRate: 48000, sampleCount: 262144, channelCount: 1 },
		sampleQuery: { startSample: 0, endSample: 131072, width: 512, height: 100 },
		readSamples: vi.fn(async (_channel, _start, count) => new Float32Array(count).fill(0.5)),
		config: {
			device: {
				limits: {
					maxComputeWorkgroupStorageSize: 32768,
					maxTextureDimension2D: 8192,
					maxBufferSize: 268435456,
					maxStorageBufferBindingSize: 134217728,
				},
			} as GPUDevice,
			signal: new AbortController().signal,
			displayTiles: true,
			spectrogram: true,
			loudness: false,
			truePeak: false,
			stereo: false,
			ltas: false,
			fftSize: 128,
			spectrogramSampling: 1,
			hopOverlap: 1,
		},
	};
}

function spectralGate() {
	let resolve: (() => void) | undefined;
	const pending = new Promise<void>((done) => {
		resolve = done;
	});
	vi.spyOn(SpectralEngine.prototype, "prepare").mockResolvedValue({} as SpectralProcessContext);
	vi.spyOn(SpectralEngine.prototype, "submitChunk").mockImplementation(() => undefined);
	const finalize = vi.spyOn(SpectralEngine.prototype, "finalize").mockImplementation(async () => {
		await pending;
		return { spectrogramTexture: { destroy: vi.fn() } as unknown as GPUTexture, ltas: null, width: 256, height: 100 };
	});
	return { finalize, release: () => resolve?.() };
}

describe("progressive display tile store", () => {
	it("retries a failed tile when its viewport is requested again", async () => {
		const options = fixture();
		options.config.spectrogram = false;
		vi.mocked(options.readSamples).mockRejectedValueOnce(new Error("Temporary read failure"));
		const store = new DisplayTileStore();
		store.update(options);
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("error"));
		store.update(options);
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
		expect(store.getSnapshot().tiles.every((tile) => tile.waveform)).toBe(true);
		store.dispose();
	});

	it("orders older fallback coverage before newer completed tiles across repeated zooms", async () => {
		const options = fixture();
		options.config.spectrogram = false;
		const store = new DisplayTileStore();
		store.update(options);
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
		const original = store.getSnapshot().tiles[0]?.waveform;
		const gate = spectralGate();
		const spectral = {
			...options,
			config: { ...options.config, spectrogram: true },
			sampleQuery: { ...options.sampleQuery, width: 256 },
		};
		store.update(spectral);
		await vi.waitFor(() => expect(gate.finalize).toHaveBeenCalledTimes(1));
		const newer = store.getSnapshot().tiles[0]?.waveform;
		expect(newer).toBeTruthy();
		store.update({ ...spectral, sampleQuery: { ...spectral.sampleQuery, width: 128 } });
		const retained = store.getSnapshot().retainedTiles.map((tile) => tile.waveform);
		expect(retained.indexOf(original ?? null)).toBeGreaterThanOrEqual(0);
		expect(retained.indexOf(newer ?? null)).toBeGreaterThan(retained.indexOf(original ?? null));
		gate.release();
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
		store.dispose();
	});

	it("cancels the supplied lifetime and leaves invalid displays idle", async () => {
		const options = fixture();
		const controller = new AbortController();
		options.config.signal = controller.signal;
		options.config.spectrogram = false;
		const store = new DisplayTileStore();
		store.update({ ...options, sampleQuery: { ...options.sampleQuery, width: 0 } });
		expect(store.getSnapshot().status).toBe("idle");
		expect(options.readSamples).not.toHaveBeenCalled();
		store.update(options);
		controller.abort();
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("idle"));
		expect(store.getSnapshot().tiles).toEqual([]);
		store.dispose();
	});

	it("keeps completed fallback tiles through consecutive incomplete view updates without duplicate keys", async () => {
		const options = fixture();
		options.config.spectrogram = false;
		const store = new DisplayTileStore();
		store.update(options);
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
		const gate = spectralGate();
		const spectral = { ...options, config: { ...options.config, spectrogram: true } };
		store.update(spectral);
		expect(store.getSnapshot().retainedTiles).toHaveLength(2);
		store.update({ ...spectral, sampleQuery: { ...spectral.sampleQuery, startSample: 1, endSample: 131073 } });
		expect(store.getSnapshot().retainedTiles).toHaveLength(2);
		const keys = [...store.getSnapshot().tiles, ...store.getSnapshot().retainedTiles].map((tile) => tile.key);
		expect(new Set(keys).size).toBe(keys.length);
		gate.release();
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
		expect(store.getSnapshot().retainedTiles).toEqual([]);
		store.dispose();
	});

	it("publishes every waveform while the first spectrum is still processing", async () => {
		const options = fixture();
		const gate = spectralGate();
		const store = new DisplayTileStore();
		store.update(options);
		await vi.waitFor(() => expect(store.getSnapshot().tiles.every((tile) => tile.waveform)).toBe(true));
		expect(store.getSnapshot().tiles).toHaveLength(2);
		expect(store.getSnapshot().tiles.every((tile) => !tile.spectrogram)).toBe(true);
		expect(store.getSnapshot().progress).toBe(0.5);
		await vi.waitFor(() => expect(gate.finalize).toHaveBeenCalledTimes(1));
		gate.release();
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
		expect(vi.mocked(options.readSamples).mock.calls.filter((call) => call[2] === 65536)).toHaveLength(2);
		store.dispose();
	});

	it("publishes cache hits synchronously in a new consumer without rereading", async () => {
		const options = fixture();
		options.config.spectrogram = false;
		const first = new DisplayTileStore();
		first.update(options);
		await vi.waitFor(() => expect(first.getSnapshot().status).toBe("ready"));
		const reads = vi.mocked(options.readSamples).mock.calls.length;
		const second = new DisplayTileStore();
		second.update(options);
		expect(second.getSnapshot().status).toBe("ready");
		expect(second.getSnapshot().tiles[0]?.waveform).toBe(first.getSnapshot().tiles[0]?.waveform);
		expect(options.readSamples).toHaveBeenCalledTimes(reads);
		first.dispose();
		second.dispose();
	});

	it("retains overlapping spectral work when the viewport moves", async () => {
		const options = fixture();
		const gate = spectralGate();
		const store = new DisplayTileStore();
		store.update(options);
		await vi.waitFor(() => expect(gate.finalize).toHaveBeenCalledTimes(1));
		const waveform = store.getSnapshot().tiles[0]?.waveform;
		store.update({ ...options, sampleQuery: { ...options.sampleQuery, startSample: 1, endSample: 131073 } });
		expect(store.getSnapshot().tiles[0]?.waveform).toBe(waveform);
		gate.release();
		await vi.waitFor(() => expect(store.getSnapshot().status).toBe("ready"));
		expect(gate.finalize).toHaveBeenCalledTimes(3);
		expect(vi.mocked(options.readSamples).mock.calls.filter((call) => call[2] === 65536)).toHaveLength(3);
		store.dispose();
	});

	it("isolates consumer cancellation and never publishes after disposal", async () => {
		const options = fixture();
		const gate = spectralGate();
		const first = new DisplayTileStore();
		const second = new DisplayTileStore();
		const listener = vi.fn();
		first.subscribe(listener);
		first.update(options);
		second.update(options);
		await vi.waitFor(() => expect(gate.finalize).toHaveBeenCalledTimes(1));
		first.dispose();
		const notifications = listener.mock.calls.length;
		gate.release();
		await vi.waitFor(() => expect(second.getSnapshot().status).toBe("ready"));
		expect(listener).toHaveBeenCalledTimes(notifications);
		expect(gate.finalize).toHaveBeenCalledTimes(2);
		second.dispose();
	});
});
