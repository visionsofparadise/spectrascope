import { beforeEach, expect, it, vi } from "vitest";
import { SpectrogramCanvas } from "./SpectrogramCanvas";
import type { ComputeResultReady } from "./useSpectralCompute";

const runtime = vi.hoisted(() => ({ effects: [] as Array<() => unknown>, render: vi.fn() }));
vi.mock("react", () => ({
	useRef: (current: unknown) => ({ current }),
	useEffect: (effect: () => unknown) => runtime.effects.push(effect),
}));
vi.mock("./useCanvasRef", () => ({ useCanvasRef: () => [{ current: {} }, vi.fn()] }));
vi.mock("./utils/resolveRenderDimensions", () => ({ resolveRenderDimensions: (size: unknown) => size }));
vi.mock("./utils/textureOwnership", () => ({ retainTexture: vi.fn() }));
vi.mock("./engine/blit", () => ({
	BlitRenderer: class {
		resize = vi.fn();
		render = runtime.render;
		destroy = vi.fn();
	},
}));

beforeEach(() => {
	runtime.effects = [];
	runtime.render.mockClear();
});

it("crops the anchored FFT context to the viewed samples", () => {
	const texture = {} as GPUTexture;
	const result = {
		status: "ready",
		spectrogramTexture: texture,
		spectrogramRange: { startSample: 32, endSample: 64 },
		query: { startMs: 47, endMs: 49 },
		options: { metadata: { sampleRate: 1000 }, sampleQuery: { width: 800, height: 400 }, config: {} },
	} as ComputeResultReady;
	SpectrogramCanvas({ computeResult: result, frequencyRange: { top: 0.25, bottom: 0.75 } });
	for (const effect of runtime.effects) effect();
	expect(runtime.render).toHaveBeenCalledWith(texture, { top: 0.25, bottom: 0.75 }, { left: 15 / 32, right: 17 / 32 });
});

it("preserves the full texture for results without surrounding FFT context", () => {
	const texture = {} as GPUTexture;
	const result = {
		status: "ready",
		spectrogramTexture: texture,
		query: { startMs: 0, endMs: 1000 },
		options: { metadata: { sampleRate: 1000 }, sampleQuery: { width: 800, height: 400 }, config: {} },
	} as ComputeResultReady;
	SpectrogramCanvas({ computeResult: result });
	for (const effect of runtime.effects) effect();
	expect(runtime.render).toHaveBeenCalledWith(texture, undefined, undefined);
});
