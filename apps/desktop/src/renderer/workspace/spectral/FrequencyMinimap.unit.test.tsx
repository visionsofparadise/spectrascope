import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrequencyMinimap } from "./FrequencyMinimap";
import { EMPTY_AUDIO_DATA } from "../views/viewAudio";
import type { ComponentProps, ReactElement } from "react";

const runtime = vi.hoisted(() => ({ index: 0, refs: [] as Array<{ current: unknown }> }));
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
vi.mock("spectral-display", () => ({ useSpectralCompute: () => ({ status: "idle" }), SpectrogramCanvas: () => null }));

function buttons(node: unknown): Array<ReactElement<ComponentProps<"button">>> {
	if (!node || typeof node !== "object") return [];
	if (Array.isArray(node)) return node.flatMap(buttons);
	const element = node as ReactElement<{ children?: unknown }>;
	return [
		...(element.type === "button" ? [element as ReactElement<ComponentProps<"button">>] : []),
		...buttons(element.props?.children),
	];
}
function render(change: ReturnType<typeof vi.fn>) {
	runtime.index = 0;
	return buttons(
		FrequencyMinimap({
			audioData: EMPTY_AUDIO_DATA,
			startMs: 0,
			endMs: 1000,
			layerColor: { primary: "#ffffff", secondary: "#000000" },
			channelInput: "mono",
			frequencyRange: { top: 0.25, bottom: 0.75 },
			onFrequencyRangeChange: change,
		}),
	);
}
beforeEach(() => {
	runtime.refs = [];
	runtime.index = 0;
});
describe("frequency minimap controls", () => {
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
