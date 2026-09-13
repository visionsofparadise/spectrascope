import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDisplayCompute } from "./useDisplayCompute";
import type { DisplayTileStoreSnapshot } from "./engine/DisplayTileStore";
import type { PipelineResult } from "./engine/runPipeline";
import type { SpectralOptions } from "./useSpectralCompute";

const runtime = vi.hoisted(() => ({
	cursor: 0,
	slots: [] as unknown[],
	effects: [] as Array<() => void>,
	cleanups: new Map<number, () => void>(),
	frames: new Map<number, FrameRequestCallback>(),
	nextFrame: 0,
	device: {} as GPUDevice,
	getDevice: vi.fn(),
	stores: [] as Array<{
		snapshot: DisplayTileStoreSnapshot;
		listeners: Set<() => void>;
		update: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("react", () => ({
	useRef: (value: unknown) => {
		const index = runtime.cursor++;
		runtime.slots[index] ??= { current: value };
		return runtime.slots[index];
	},
	useState: (value: unknown) => {
		const index = runtime.cursor++;
		runtime.slots[index] ??= value;
		return [
			runtime.slots[index],
			(next: unknown) => {
				runtime.slots[index] = next;
			},
		];
	},
	useEffect: (effect: () => unknown, dependencies: unknown[]) => {
		const index = runtime.cursor++;
		const previous = runtime.slots[index] as unknown[] | undefined;
		if (previous && dependencies.every((value, position) => Object.is(value, previous[position]))) return;
		runtime.slots[index] = dependencies;
		runtime.effects.push(() => {
			runtime.cleanups.get(index)?.();
			const cleanup = effect();
			if (typeof cleanup === "function") runtime.cleanups.set(index, cleanup as () => void);
			else runtime.cleanups.delete(index);
		});
	},
}));

vi.mock("./engine/device", () => ({ getDevice: runtime.getDevice }));
vi.mock("./utils/resolveRenderDimensions", () => ({ resolveRenderDimensions: (size: unknown) => size }));
vi.mock("./engine/DisplayTileStore", () => ({
	DisplayTileStore: class {
		snapshot: DisplayTileStoreSnapshot = { status: "computing", progress: 0, tiles: [], retainedTiles: [] };
		listeners = new Set<() => void>();
		update = vi.fn();
		dispose = vi.fn();
		constructor() {
			runtime.stores.push(this);
		}
		getSnapshot = () => this.snapshot;
		subscribe = (listener: () => void) => {
			this.listeners.add(listener);
			return () => this.listeners.delete(listener);
		};
	},
}));

function options(): SpectralOptions {
	return {
		metadata: { sampleRate: 1000, sampleCount: 2000, channelCount: 1 },
		query: { startMs: 0, endMs: 1000, width: 100, height: 100 },
		readSamples: vi.fn(async () => new Float32Array()),
	};
}

function render(value: SpectralOptions) {
	runtime.cursor = 0;
	const result = useDisplayCompute(value);
	for (const effect of runtime.effects.splice(0)) effect();
	return result;
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
}

function frame() {
	const callbacks = [...runtime.frames.values()];
	runtime.frames.clear();
	for (const callback of callbacks) callback(0);
}

function publish(snapshot: Partial<DisplayTileStoreSnapshot>) {
	const store = runtime.stores[runtime.stores.length - 1]!;
	store.snapshot = { ...store.snapshot, ...snapshot };
	for (const listener of store.listeners) listener();
}

function layer(texture: GPUTexture | null = null): PipelineResult {
	return {
		waveformBuffer: new Float32Array([1, 2]),
		waveformPointCount: 1,
		waveformSamplesPerPoint: 16,
		loudnessData: null,
		ltas: null,
		correlationEnvelope: null,
		vectorscopeHistogram: null,
		spectrogramTexture: texture,
		displayEndSample: 1024,
		options: {
			metadata: options().metadata,
			readSamples: options().readSamples,
			sampleQuery: { startSample: 0, endSample: 1000, width: 256, height: 100 },
			config: {} as PipelineResult["options"]["config"],
		},
	};
}

function tile(waveform: PipelineResult | null, spectrogram: PipelineResult | null = null) {
	return {
		key: "tile",
		startSample: 0,
		endSample: 1000,
		displayEndSample: 1024,
		width: 256,
		height: 100,
		waveform,
		spectrogram,
	};
}

function unmount() {
	for (const cleanup of runtime.cleanups.values()) cleanup();
	runtime.cleanups.clear();
}

beforeEach(() => {
	runtime.cursor = 0;
	runtime.slots = [];
	runtime.effects = [];
	runtime.cleanups.clear();
	runtime.frames.clear();
	runtime.stores = [];
	runtime.getDevice.mockReset().mockImplementation(async (device: GPUDevice | undefined) => device ?? runtime.device);
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		const id = ++runtime.nextFrame;
		runtime.frames.set(id, callback);
		return id;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => runtime.frames.delete(id));
});

afterEach(() => {
	unmount();
	vi.unstubAllGlobals();
});

it("batches publications by frame and preserves completed layer references", async () => {
	const input = options();
	render(input);
	await settle();
	const waveform = layer();
	publish({ progress: 0.25, tiles: [tile(waveform)] });
	publish({ progress: 0.5 });
	expect(runtime.frames.size).toBe(1);
	expect(render(input).tiles).toEqual([]);
	frame();
	const partial = render(input);
	expect(partial.fraction).toBe(0.5);
	expect(partial.tiles[0]!.waveform!.query.endMs).toBe(1024);
	const spectrogram = layer();
	publish({ status: "ready", progress: 1, tiles: [tile(waveform, spectrogram)] });
	frame();
	const complete = render(input);
	expect(complete.tiles[0]!.waveform).toBe(partial.tiles[0]!.waveform);
	expect(complete.tiles[0]!.spectrogram).not.toBeNull();
});

it("updates pan and source requests on the existing store", async () => {
	const input = options();
	render(input);
	await settle();
	const changed = { ...input, query: { ...input.query, startMs: 250, endMs: 1250 } };
	render(changed);
	await settle();
	const source = { ...changed, readSamples: options().readSamples };
	render(source);
	await settle();
	expect(runtime.stores).toHaveLength(1);
	expect(runtime.stores[0]!.update).toHaveBeenCalledTimes(3);
	expect(runtime.stores[0]!.update.mock.lastCall![0].readSamples).toBe(source.readSamples);
	expect(runtime.stores[0]!.dispose).not.toHaveBeenCalled();
});

it("keeps pending and displayed textures alive until their replacement commits", async () => {
	const input = options();
	render(input);
	await settle();
	const destroy = vi.fn();
	const texture = { destroy } as unknown as GPUTexture;
	publish({ tiles: [tile(layer(), layer(texture))] });
	frame();
	render(input);
	publish({ tiles: [] });
	expect(destroy).not.toHaveBeenCalled();
	frame();
	expect(destroy).not.toHaveBeenCalled();
	render(input);
	expect(destroy).toHaveBeenCalledTimes(1);
});

it("releases superseded unpublished textures and cancels frame callbacks on unmount", async () => {
	const input = options();
	render(input);
	await settle();
	const destroy = vi.fn();
	publish({ tiles: [tile(null, layer({ destroy } as unknown as GPUTexture))] });
	publish({ tiles: [] });
	unmount();
	expect(destroy).toHaveBeenCalledTimes(1);
	expect(runtime.frames.size).toBe(0);
	expect(runtime.stores[0]!.listeners.size).toBe(0);
	expect(runtime.stores[0]!.dispose).toHaveBeenCalledTimes(1);
});

it("replaces device resources and ignores an obsolete device acquisition", async () => {
	let resolve!: (device: GPUDevice) => void;
	runtime.getDevice.mockImplementationOnce(
		() =>
			new Promise<GPUDevice>((done) => {
				resolve = done;
			}),
	);
	const input = options();
	render(input);
	const next = { ...input, config: { device: {} as GPUDevice } };
	render(next);
	await settle();
	resolve(runtime.device);
	await settle();
	expect(runtime.stores).toHaveLength(1);
	render({ ...next, config: { device: {} as GPUDevice } });
	await settle();
	expect(runtime.stores).toHaveLength(2);
	expect(runtime.stores[0]!.dispose).toHaveBeenCalledTimes(1);
	expect(runtime.stores[0]!.listeners.size).toBe(0);
});

it("does not create resources after unmount during device acquisition", async () => {
	let resolve!: (device: GPUDevice) => void;
	runtime.getDevice.mockImplementationOnce(
		() =>
			new Promise<GPUDevice>((done) => {
				resolve = done;
			}),
	);
	render(options());
	unmount();
	resolve(runtime.device);
	await settle();
	expect(runtime.stores).toHaveLength(0);
	expect(runtime.frames.size).toBe(0);
});

it("preserves retained coverage beneath newly arriving tiles", async () => {
	const input = options();
	render(input);
	await settle();
	const previous = tile(layer());
	const next = { ...tile(layer()), key: "next-tile" };
	publish({ retainedTiles: [previous], tiles: [next] });
	frame();
	const result = render(input);
	expect(result.tiles.map((value) => value.key)).toEqual(["tile", "next-tile"]);
	publish({ retainedTiles: [], status: "ready", progress: 1 });
	frame();
	const complete = render(input);
	expect(complete.tiles).toHaveLength(1);
	expect(complete.tiles[0]!.waveform).toBe(result.tiles[1]!.waveform);
});

it("does not overwrite an acquisition error with an already scheduled frame", async () => {
	const input = options();
	render(input);
	await settle();
	publish({ tiles: [tile(layer())] });
	runtime.getDevice.mockRejectedValueOnce(new Error("Device unavailable"));
	render({ ...input, config: { device: {} as GPUDevice } });
	await settle();
	frame();
	const result = render(input);
	expect(result.status).toBe("error");
	expect(result.error?.message).toBe("Device unavailable");
});

it("keeps acquisition errors visible when an older store completes", async () => {
	const input = options();
	render(input);
	await settle();
	runtime.getDevice.mockRejectedValueOnce(new Error("Device unavailable"));
	const next = { ...input, config: { device: {} as GPUDevice } };
	render(next);
	await settle();
	publish({ status: "ready", progress: 1, tiles: [tile(layer())] });
	frame();
	expect(render(next).status).toBe("error");
});

it("rebinds cached waveform arrays to the current rendering device", async () => {
	const input = options();
	const waveform = layer();
	waveform.options.config.device = runtime.device;
	render(input);
	await settle();
	publish({ tiles: [tile(waveform)] });
	frame();
	const previous = render(input).tiles[0]!.waveform;
	const device = {} as GPUDevice;
	const next = { ...input, config: { device } };
	render(next);
	await settle();
	publish({ tiles: [tile(waveform)] });
	frame();
	const result = render(next).tiles[0]!.waveform!;
	expect(result.options.config.device).toBe(device);
	expect(result.waveformBuffer).toBe(previous!.waveformBuffer);
	expect(result).not.toBe(previous);
});

it("rerasterizes cached waveform data at the resized display height", async () => {
	const input = options();
	const waveform = layer();
	waveform.options.sampleQuery.height = 16;
	render(input);
	await settle();
	publish({ tiles: [tile(waveform)] });
	frame();
	const previous = render(input).tiles[0]!.waveform;
	expect(previous!.options.sampleQuery.height).toBe(100);
	const next = { ...input, query: { ...input.query, height: 300 } };
	render(next);
	await settle();
	publish({ tiles: [tile(waveform)] });
	frame();
	const result = render(next).tiles[0]!.waveform!;
	expect(result.options.sampleQuery.height).toBe(300);
	expect(result.waveformBuffer).toBe(previous!.waveformBuffer);
	expect(result).not.toBe(previous);
});

it("draws a shared waveform once above retained and replacement palettes", async () => {
	const input = options();
	const waveform = layer();
	const oldTexture = { destroy: vi.fn() } as unknown as GPUTexture;
	const newTexture = { destroy: vi.fn() } as unknown as GPUTexture;
	const previous = { ...tile(waveform, layer(oldTexture)), key: "old-palette" };
	const next = { ...tile(waveform, layer(newTexture)), key: "new-palette" };
	render(input);
	await settle();
	publish({ retainedTiles: [previous], tiles: [next] });
	frame();
	const result = render(input);
	expect(result.tiles.map((value) => value.key)).toEqual(["old-palette", "new-palette"]);
	expect(result.tiles.filter((value) => value.waveform)).toHaveLength(1);
	expect(result.tiles[0]!.waveform).toBeNull();
	expect(result.tiles[1]!.waveform!.waveformBuffer).toBe(waveform.waveformBuffer);
	expect(result.tiles.map((value) => value.spectrogram!.spectrogramTexture)).toEqual([oldTexture, newTexture]);
	const readyWaveform = result.tiles[1]!.waveform;
	publish({ retainedTiles: [], status: "ready", progress: 1 });
	frame();
	const completed = render(input);
	expect(completed.tiles).toHaveLength(1);
	expect(completed.tiles[0]!.waveform).toBe(readyWaveform);
	expect(oldTexture.destroy).toHaveBeenCalledTimes(1);
	expect(newTexture.destroy).not.toHaveBeenCalled();
});
