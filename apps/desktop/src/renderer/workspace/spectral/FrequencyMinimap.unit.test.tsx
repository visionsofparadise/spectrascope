import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrequencyMinimap } from "./FrequencyMinimap";
import { ScrollTrack } from "./ScrollTrack";
import { MIN_FREQUENCY_SPAN } from "../utils/frequencyRange";
import { EMPTY_AUDIO_DATA } from "../views/viewAudio";
import type { ComponentProps, ReactElement } from "react";
import type { FrequencyScale } from "spectral-display";

const runtime = vi.hoisted(() => ({ index: 0, refs: [] as Array<{ current: unknown }> }));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useRef: (initial: unknown) => {
		const index = runtime.index++;
		return (runtime.refs[index] ??= { current: initial });
	},
	useCallback: (callback: unknown) => callback,
	useEffect: () => {},
}));

type TrackElement = ReactElement<ComponentProps<typeof ScrollTrack>>;
type ButtonElement = ReactElement<ComponentProps<"button">>;

function renderTrack(change: ReturnType<typeof vi.fn>, frequencyScale: FrequencyScale = "mel", amplitude = false) {
	return FrequencyMinimap({
		amplitude,
		sampleRate: EMPTY_AUDIO_DATA.sampleRate,
		frequencyRange: { top: 0.25, bottom: 0.75 },
		frequencyScale,
		onFrequencyRangeChange: change,
	}) as TrackElement;
}
function buttons(node: unknown): Array<ButtonElement> {
	if (!node || typeof node !== "object") return [];
	if (Array.isArray(node)) return node.flatMap(buttons);
	const element = node as ReactElement<{ children?: unknown }>;
	return [...(element.type === "button" ? [element as ButtonElement] : []), ...buttons(element.props?.children)];
}
function controlsOf(track: TrackElement) {
	runtime.index = 0;
	return buttons(ScrollTrack(track.props));
}
function keyDown(button: ButtonElement | undefined, key: string) {
	button?.props.onKeyDown?.({
		key,
		shiftKey: false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	} as unknown as React.KeyboardEvent<HTMLButtonElement>);
}

beforeEach(() => {
	runtime.refs = [];
	runtime.index = 0;
});

describe("frequency track", () => {
	it("renders the design scroll track with the frequency crop and minimum span", () => {
		const track = renderTrack(vi.fn());
		expect(track.type).toBe(ScrollTrack);
		expect(track.props.axis).toBe("y");
		expect(track.props.range).toEqual({ start: 0.25, end: 0.75 });
		expect(track.props.minSpan).toBe(MIN_FREQUENCY_SPAN);
		expect(controlsOf(track).map((button) => button.props["aria-label"])).toEqual([
			"Frequency range",
			"Upper frequency limit",
			"Lower frequency limit",
		]);
	});
	it("keeps amplitude labels and value texts", () => {
		const controls = controlsOf(renderTrack(vi.fn(), "mel", true));
		const text = (label: string) =>
			controls.find((button) => button.props["aria-label"] === label)?.props["aria-valuetext"];
		expect(text("Amplitude range")).toBe("-0.5 to 0.5 FS");
		expect(text("Upper amplitude limit")).toBe("0.5 FS");
		expect(text("Lower amplitude limit")).toBe("-0.5 FS");
	});
	it("uses the selected scale for accessible frequency values", () => {
		const track = renderTrack(vi.fn(), "linear");
		const nyquist = EMPTY_AUDIO_DATA.sampleRate / 2;
		expect(track.props.valueText).toBe(`${Math.round(nyquist * 0.25)} to ${Math.round(nyquist * 0.75)} Hz`);
		expect(track.props.edgeValueTexts).toEqual([
			`${Math.round(nyquist * 0.75)} Hz`,
			`${Math.round(nyquist * 0.25)} Hz`,
		]);
	});
	it("zooms and resets through keyboard and double-click as frequency ranges", () => {
		const change = vi.fn();
		const controls = controlsOf(renderTrack(change));
		const pan = controls.find((button) => button.props["aria-label"] === "Frequency range");
		keyDown(pan, "+");
		expect(change).toHaveBeenCalledWith({ top: 0.3, bottom: 0.7 });
		keyDown(pan, "Escape");
		expect(change).toHaveBeenLastCalledWith({ top: 0, bottom: 1 });
		change.mockClear();
		keyDown(pan, "0");
		expect(change).toHaveBeenLastCalledWith({ top: 0, bottom: 1 });
		change.mockClear();
		pan?.props.onDoubleClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(change).toHaveBeenCalledWith({ top: 0, bottom: 1 });
	});
	it("focuses and pans a captured drag within the full spectrum", () => {
		const change = vi.fn();
		const controls = controlsOf(renderTrack(change));
		runtime.refs[0]!.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 8, height: 100 }) };
		const surface = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true };
		const pan = controls.find((button) => button.props["aria-label"] === "Frequency range");
		const event = {
			button: 0,
			pointerId: 1,
			clientX: 0,
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
