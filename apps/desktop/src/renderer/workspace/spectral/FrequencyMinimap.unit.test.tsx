import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrequencyMinimap } from "./FrequencyMinimap";
import { EMPTY_AUDIO_DATA } from "../views/viewAudio";
import { SpectrogramCanvas } from "spectral-display";
import type { ComponentProps, ReactElement } from "react";
import type { ComputeResultReady, FrequencyScale } from "spectral-display";

const runtime = vi.hoisted(() => ({
	index: 0,
	refs: [] as Array<{ current: unknown }>,
	result: null as ComputeResultReady | null,
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useRef: (initial: unknown) => {
		const index = runtime.index++;
		return (runtime.refs[index] ??= { current: initial });
	},
	useMemo: (compute: () => unknown) => compute(),
	useCallback: (callback: unknown) => callback,
	useEffect: () => {},
}));
vi.mock("./useContainerSize", () => ({ useContainerSize: () => ({ width: 64, height: 800 }) }));
vi.mock("spectral-display", async (importOriginal) => ({
	...(await importOriginal<typeof import("spectral-display")>()),
	useSpectralCompute: vi.fn(() => {
		throw new Error("Minimap must reuse displayed spectrum");
	}),
	SpectrogramCanvas: () => null,
}));

function buttons(node: unknown): Array<ReactElement<ComponentProps<"button">>> {
	if (!node || typeof node !== "object") return [];
	if (Array.isArray(node)) return node.flatMap(buttons);
	const element = node as ReactElement<{ children?: unknown }>;
	return [
		...(element.type === "button" ? [element as ReactElement<ComponentProps<"button">>] : []),
		...buttons(element.props?.children),
	];
}
function renderTree(change: ReturnType<typeof vi.fn>, frequencyScale: FrequencyScale = "mel") {
	runtime.index = 0;
	return FrequencyMinimap({
		sampleRate: EMPTY_AUDIO_DATA.sampleRate,
		computeResult: runtime.result,
		frequencyRange: { top: 0.25, bottom: 0.75 },
		frequencyScale,
		onFrequencyRangeChange: change,
	});
}
function render(change: ReturnType<typeof vi.fn>) {
	return buttons(renderTree(change));
}
function hasCanvas(node: unknown): boolean {
	if (Array.isArray(node)) return node.some(hasCanvas);
	if (!node || typeof node !== "object") return false;
	const element = node as ReactElement<{ children?: unknown }>;
	return element.type === SpectrogramCanvas || hasCanvas(element.props?.children);
}
beforeEach(() => {
	runtime.refs = [];
	runtime.index = 0;
	runtime.result = null;
});
describe("frequency minimap controls", () => {
	it("uses the selected scale for accessible frequency values", () => {
		const controls = buttons(renderTree(vi.fn(), "linear"));
		const pan = controls.find((button) => button.props["aria-label"] === "Frequency range");
		const nyquist = EMPTY_AUDIO_DATA.sampleRate / 2;
		expect(pan?.props["aria-valuetext"]).toBe(`${Math.round(nyquist * 0.25)} to ${Math.round(nyquist * 0.75)} Hz`);
	});
	it("hides held pixels from a different scale until matching output is ready", () => {
		const previous = { status: "ready", options: { config: { frequencyScale: "mel" } } };
		runtime.result = previous as ComputeResultReady;
		expect(hasCanvas(renderTree(vi.fn(), "linear"))).toBe(false);
		expect(hasCanvas(renderTree(vi.fn(), "mel"))).toBe(true);
		runtime.result = { status: "ready", options: { config: { frequencyScale: "linear" } } } as ComputeResultReady;
		expect(hasCanvas(renderTree(vi.fn(), "linear"))).toBe(true);
	});
	it("zooms and resets through keyboard and the named reset action", () => {
		const change = vi.fn();
		const controls = render(change);
		const pan = controls.find((button) => button.props["aria-label"] === "Frequency range");
		pan?.props.onKeyDown?.({
			key: "+",
			shiftKey: false,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		} as unknown as React.KeyboardEvent<HTMLButtonElement>);
		expect(change).toHaveBeenCalledWith({ top: 0.3, bottom: 0.7 });
		controls
			.find((button) => button.props["aria-label"] === "Reset frequency range")
			?.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(change).toHaveBeenLastCalledWith({ top: 0, bottom: 1 });
	});
	it("focuses and pans a captured drag within the full spectrum", () => {
		const change = vi.fn();
		const controls = render(change);
		runtime.refs[0]!.current = { getBoundingClientRect: () => ({ top: 0, height: 100 }) };
		const surface = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true };
		const pan = controls.find((button) => button.props["aria-label"] === "Frequency range");
		const event = {
			button: 0,
			pointerId: 1,
			clientY: 50,
			currentTarget: surface,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		} as unknown as React.PointerEvent<HTMLButtonElement>;
		pan?.props.onPointerDown?.(event);
		pan?.props.onPointerMove?.({ ...event, clientY: 80 });
		expect(surface.focus).toHaveBeenCalled();
		expect(change).toHaveBeenLastCalledWith({ top: 0.5, bottom: 1 });
	});
});
