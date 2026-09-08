import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaveformCanvas } from "./WaveformCanvas";
import { resolveConfig } from "./engine/SpectralEngine";
import type { ComputeResultReady } from "./useSpectralCompute";
import type { TextureVerticalRange } from "./engine/blit";

const runtime = vi.hoisted(() => ({
	index: 0,
	refs: [] as Array<{ current: unknown }>,
	effects: [] as Array<() => void | (() => void)>,
	cleanups: [] as Array<() => void>,
	canvas: { width: 0, height: 0 },
	resize: vi.fn(),
	render: vi.fn(),
}));

vi.mock("react", () => ({
	useRef: (initial: unknown) => (runtime.refs[runtime.index++] ??= { current: initial }),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => void | (() => void)) => runtime.effects.push(effect),
}));
vi.mock("./useCanvasRef", () => ({ useCanvasRef: () => [{ current: runtime.canvas }, vi.fn()] }));
vi.mock("./engine/blit", () => ({
	BlitRenderer: class {
		resize = runtime.resize;
		render = runtime.render;
		destroy = vi.fn();
	},
}));

function resultOf(): {
	result: ComputeResultReady;
	writes: ReturnType<typeof vi.fn>;
	buffers: Array<{ destroy: ReturnType<typeof vi.fn> }>;
} {
	const writes = vi.fn();
	const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
	const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() };
	const device = {
		queue: { writeBuffer: writes, submit: vi.fn() },
		createShaderModule: vi.fn(),
		createComputePipeline: () => ({ getBindGroupLayout: vi.fn() }),
		createBuffer: ({ size }: { size: number }) => {
			const buffer = { destroy: vi.fn(), getMappedRange: () => new ArrayBuffer(size), unmap: vi.fn() };
			buffers.push(buffer);
			return buffer;
		},
		createTexture: () => ({ createView: vi.fn(), destroy: vi.fn() }),
		createBindGroup: vi.fn(),
		createCommandEncoder: () => ({ beginComputePass: () => pass, finish: vi.fn() }),
	} as unknown as GPUDevice;
	const startSample = 172800000;
	const startMs = ((startSample + 0.25) * 1000) / 48000;
	return {
		writes,
		buffers,
		result: {
			status: "ready",
			waveformBuffer: new Float32Array([0, 0, 1, 1, -1, -1]),
			waveformPointCount: 3,
			waveformSamplesPerPoint: 1,
			spectrogramTexture: null,
			loudnessData: null,
			ltas: null,
			correlationEnvelope: null,
			vectorscopeHistogram: null,
			query: { startMs, endMs: startMs + 2 / 48, width: 1920, height: 600 },
			options: {
				metadata: { sampleRate: 48000, sampleCount: startSample + 1000, channelCount: 1 },
				sampleQuery: { startSample, endSample: startSample + 3, width: 1920, height: 600 },
				readSamples: async () => new Float32Array(),
				config: resolveConfig({ device, signal: new AbortController().signal }),
			},
		},
	};
}

function render(result: ComputeResultReady, onRendered = vi.fn(), verticalRange?: TextureVerticalRange) {
	runtime.index = 0;
	WaveformCanvas({ computeResult: result, onRendered, verticalRange });
	for (const effect of runtime.effects.splice(0)) {
		const cleanup = effect();
		if (cleanup) runtime.cleanups.push(cleanup);
	}
}

beforeEach(() => {
	runtime.index = 0;
	runtime.refs = [];
	runtime.effects = [];
	runtime.cleanups = [];
	runtime.resize.mockClear();
	runtime.render.mockClear();
	vi.stubGlobal("GPUBufferUsage", { STORAGE: 128, COPY_DST: 8, UNIFORM: 64 });
	vi.stubGlobal("GPUTextureUsage", { STORAGE_BINDING: 8, TEXTURE_BINDING: 4, COPY_SRC: 1 });
});
afterEach(() => {
	for (const cleanup of runtime.cleanups) cleanup();
	vi.unstubAllGlobals();
});

describe("waveform physical sample coordinates", () => {
	it("crops the waveform blit without replacing sample buffers or changing measured values", () => {
		const { result, buffers } = resultOf();
		const waveform = result.waveformBuffer?.slice();
		render(result);
		const bufferCount = buffers.length;
		const verticalRange = { top: 0.25, bottom: 0.75 };
		render(result, vi.fn(), verticalRange);
		expect(runtime.render).toHaveBeenLastCalledWith(expect.anything(), verticalRange);
		expect(buffers).toHaveLength(bufferCount);
		expect(result.waveformBuffer).toEqual(waveform);
	});

	it("keeps fractional sample offsets precise an hour into the source", () => {
		const { result, writes } = resultOf();
		render(result);
		const uniform = new DataView(writes.mock.calls[0]![2] as ArrayBuffer);
		expect(uniform.getUint32(4, true)).toBe(1920);
		expect(uniform.getFloat32(24, true)).toBe(3);
		expect(uniform.getFloat32(28, true)).toBe(1);
		expect(uniform.getFloat32(32, true)).toBeCloseTo(0.25, 6);
		expect(uniform.getFloat32(36, true)).toBeCloseTo(2, 6);
		expect(runtime.resize).toHaveBeenCalledWith(1920, 600);
	});

	it("uses the resolved backing dimensions and releases waveform buffers on unmount", () => {
		const { result, buffers, writes } = resultOf();
		result.options.sampleQuery.width = 960;
		result.options.sampleQuery.height = 300;
		render(result);
		expect(runtime.resize).toHaveBeenCalledWith(960, 300);
		expect(new DataView(writes.mock.calls[0]![2] as ArrayBuffer).getUint32(4, true)).toBe(960);
		for (const cleanup of runtime.cleanups.splice(0)) cleanup();
		expect(buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
	});
});
