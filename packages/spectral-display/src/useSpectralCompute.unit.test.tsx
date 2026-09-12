import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpectralCompute, type ComputeResult, type SpectralOptions } from "./useSpectralCompute";
import { runPipeline, type PipelineOptions, type PipelineResult } from "./engine/runPipeline";
import { getDevice } from "./engine/device";
import { retainTexture } from "./utils/textureOwnership";
import { resolveConfig } from "./engine/SpectralEngine";

const runtime = vi.hoisted(() => ({
	index: 0,
	values: [] as Array<unknown>,
	effects: new Map<number, { dependencies: ReadonlyArray<unknown>; cleanup?: () => void }>(),
	pending: [] as Array<() => void>,
}));

vi.mock("react", () => ({
	useRef: (initial: unknown) => {
		const index = runtime.index++;
		runtime.values[index] ??= { current: initial };
		return runtime.values[index];
	},
	useState: (initial: unknown) => {
		const index = runtime.index++;
		if (!(index in runtime.values)) runtime.values[index] = initial;
		return [
			runtime.values[index],
			(value: unknown) => {
				runtime.values[index] = value;
			},
		];
	},
	useEffect: (effect: () => (() => void) | undefined, dependencies: ReadonlyArray<unknown>) => {
		const index = runtime.index++;
		const previous = runtime.effects.get(index);
		if (previous && dependencies.every((value, position) => Object.is(value, previous.dependencies[position])))
			return;
		runtime.pending.push(() => {
			previous?.cleanup?.();
			runtime.effects.set(index, { dependencies, cleanup: effect() });
		});
	},
}));

vi.mock("./engine/device", () => ({ getDevice: vi.fn() }));
vi.mock("./engine/runPipeline", () => ({ runPipeline: vi.fn() }));

function render(options: SpectralOptions): ComputeResult {
	runtime.index = 0;
	const result = useSpectralCompute(options);
	for (const effect of runtime.pending.splice(0)) effect();
	return result;
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function resultFor(options: PipelineOptions, texture: GPUTexture | null = null): PipelineResult {
	return {
		waveformBuffer: new Float32Array([0, 1]),
		waveformPointCount: 1,
		waveformSamplesPerPoint: 48000,
		loudnessData: null,
		spectrogramTexture: texture,
		ltas: null,
		correlationEnvelope: null,
		vectorscopeHistogram: null,
		options: { ...options, config: resolveConfig(options.config) },
	};
}

function optionsOf(): SpectralOptions {
	return {
		metadata: { sampleRate: 48000, sampleCount: 48000, channelCount: 1 },
		query: { startMs: 0, endMs: 1000, width: 800, height: 200 },
		readSamples: async (_channel, _offset, count) => new Float32Array(count),
	};
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	runtime.index = 0;
	runtime.values = [];
	runtime.effects.clear();
	runtime.pending = [];
	vi.mocked(getDevice)
		.mockReset()
		.mockResolvedValue({} as GPUDevice);
	vi.mocked(runPipeline).mockReset();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
	for (const effect of runtime.effects.values()) effect.cleanup?.();
	vi.unstubAllGlobals();
});

describe("analysis lifecycle", () => {
	it("revisits an exact overview without pipeline work and cancels obsolete zoom work", async () => {
		vi.mocked(runPipeline).mockImplementation(async (options) => resultFor(options));
		const options = optionsOf();
		render(options);
		await settle();
		const overview = render(options);
		const pending = deferred<PipelineResult>();
		vi.mocked(runPipeline).mockReturnValueOnce(pending.promise);
		const zoom = { ...options, query: { ...options.query, startMs: 100, endMs: 500 } };
		render(zoom);
		await settle();
		const interrupted = vi.mocked(runPipeline).mock.calls[1]![0];
		render(options);
		await settle();
		expect(render(options)).toBe(overview);
		expect(runPipeline).toHaveBeenCalledTimes(2);
		expect(interrupted.config.signal.aborted).toBe(true);
		const destroy = vi.fn();
		pending.resolve(resultFor(interrupted, { destroy } as unknown as GPUTexture));
		await settle();
		expect(destroy).toHaveBeenCalledOnce();
	});

	it("keeps fractional times and dimensions distinct and ignores caller signal identity for cache keys", async () => {
		vi.mocked(runPipeline).mockImplementation(async (options) => resultFor(options));
		const options = optionsOf();
		const first = { ...options, query: { ...options.query, startMs: 0.001 } };
		for (const query of [first.query, { ...first.query, startMs: 0.002 }, { ...first.query, width: 801 }]) {
			render({ ...first, query });
			await settle();
		}
		expect(runPipeline).toHaveBeenCalledTimes(3);
		render({ ...first, config: { signal: new AbortController().signal } });
		await settle();
		expect(runPipeline).toHaveBeenCalledTimes(3);
		const aborted = new AbortController();
		aborted.abort();
		const stopped = { ...options, config: { signal: aborted.signal } };
		render(stopped);
		await settle();
		expect(render(stopped).status).toBe("computing");
		expect(runPipeline).toHaveBeenCalledTimes(3);
	});

	it.each(["reader", "metadata", "weights", "config", "device", "sampling"])(
		"invalidates cached results when %s changes",
		async (kind) => {
			vi.mocked(runPipeline).mockImplementation(async (options) => resultFor(options));
			const options = optionsOf();
			render(options);
			await settle();
			const changed = {
				...options,
				...(kind === "reader" ? { readSamples: async () => new Float32Array(1) } : {}),
				...(kind === "metadata" ? { metadata: { ...options.metadata, sampleRate: 44100 } } : {}),
				...(kind === "weights" ? { metadata: { ...options.metadata, channelWeights: [0.5] } } : {}),
				...(kind === "config" ? { config: { frequencyScale: "mel" as const } } : {}),
				...(kind === "sampling" ? { config: { spectrogramSampling: 4 as const } } : {}),
			};
			if (kind === "device") vi.mocked(getDevice).mockResolvedValue({} as GPUDevice);
			render({ ...changed, query: { ...changed.query, endMs: 500 } });
			await settle();
			render(changed);
			await settle();
			expect(runPipeline).toHaveBeenCalledTimes(3);
		},
	);

	it("invalidates equal-sized reader replacements and destroys their late obsolete output", async () => {
		const first = deferred<PipelineResult>();
		const second = deferred<PipelineResult>();
		vi.mocked(runPipeline).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const options = optionsOf();
		render(options);
		await settle();
		const initial = vi.mocked(runPipeline).mock.calls[0]![0];
		const replacement = { ...options, readSamples: async () => new Float32Array([1]) };
		render(replacement);
		await settle();
		const next = vi.mocked(runPipeline).mock.calls[1]![0];
		expect(initial.config.signal.aborted).toBe(true);
		second.resolve(resultFor(next));
		await settle();
		const accepted = render(replacement);
		expect(accepted.status).toBe("ready");
		const destroy = vi.fn();
		first.resolve(resultFor(initial, { destroy } as unknown as GPUTexture));
		await settle();
		expect(render(replacement)).toBe(accepted);
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it("clears empty input and releases hook ownership after committing idle", async () => {
		const destroy = vi.fn();
		const texture = { destroy } as unknown as GPUTexture;
		vi.mocked(runPipeline).mockImplementation(async (options) => resultFor(options, texture));
		const options = optionsOf();
		render(options);
		await settle();
		expect(render(options).status).toBe("ready");
		const releaseCanvas = retainTexture(texture);
		const empty = { ...options, metadata: { ...options.metadata, sampleCount: 0 } };
		render(empty);
		expect(render(empty).status).toBe("idle");
		expect(destroy).not.toHaveBeenCalled();
		releaseCanvas();
		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it("combines caller abort with lifecycle cancellation and suppresses abort failures", async () => {
		const pending = deferred<PipelineResult>();
		vi.mocked(runPipeline).mockReturnValue(pending.promise);
		const controller = new AbortController();
		const options = { ...optionsOf(), config: { signal: controller.signal } };
		render(options);
		await settle();
		const received = vi.mocked(runPipeline).mock.calls[0]![0];
		expect(received.config.signal).not.toBe(controller.signal);
		controller.abort();
		expect(received.config.signal.aborted).toBe(true);
		pending.reject(new Error("reader failed after cancellation"));
		await settle();
		expect(render(options).status).toBe("computing");
	});

	it("does not start the pipeline when device acquisition finishes after cleanup", async () => {
		const device = deferred<GPUDevice>();
		vi.mocked(getDevice).mockReturnValue(device.promise);
		const options = optionsOf();
		render(options);
		const empty = { ...options, query: { ...options.query, endMs: 0 } };
		render(empty);
		device.resolve({} as GPUDevice);
		await settle();
		expect(runPipeline).not.toHaveBeenCalled();
		expect(render(empty).status).toBe("idle");
	});

	it("uses changed devices and channel weights while retaining the last successful result on errors", async () => {
		vi.mocked(getDevice).mockImplementation(async (device) => device!);
		vi.mocked(runPipeline).mockImplementation(async (options) => resultFor(options));
		const firstDevice = {} as GPUDevice;
		const secondDevice = {} as GPUDevice;
		const options = { ...optionsOf(), config: { device: firstDevice } };
		render(options);
		await settle();
		render(options);
		const changed = {
			...options,
			config: { device: secondDevice },
			metadata: { ...options.metadata, channelWeights: [0] },
		};
		render(changed);
		await settle();
		const ready = render(changed);
		expect(vi.mocked(runPipeline).mock.calls[1]![0].config.device).toBe(secondDevice);
		expect(vi.mocked(runPipeline).mock.calls[1]![0].metadata.channelWeights).toEqual([0]);
		vi.mocked(runPipeline).mockRejectedValue(new Error("read failed"));
		const failed = { ...changed, metadata: { ...changed.metadata, channelWeights: [1] } };
		render(failed);
		await settle();
		expect(render(failed)).toMatchObject({ status: "error", previous: ready });
	});
});
