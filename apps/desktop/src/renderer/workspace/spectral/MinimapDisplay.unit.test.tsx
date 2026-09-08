import { beforeEach, expect, it, vi } from "vitest";
import { MinimapDisplay } from "./MinimapDisplay";
import { EMPTY_AUDIO_DATA } from "../views/viewAudio";
import type { ComponentProps, ReactElement } from "react";

const runtime = vi.hoisted(() => ({
	index: 0,
	refs: [] as Array<{ current: unknown }>,
	result: { status: "ready" } as unknown,
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useRef: (value: unknown) => runtime.refs[runtime.index++] ?? (runtime.refs[runtime.index - 1] = { current: value }),
	useMemo: (factory: () => unknown) => factory(),
	useCallback: (callback: unknown) => callback,
}));
vi.mock("./useContainerSize", () => ({ useContainerSize: () => ({ width: 800, height: 32 }) }));
vi.mock("spectral-display", () => ({ useSpectralCompute: () => runtime.result, WaveformCanvas: () => null }));
beforeEach(() => {
	runtime.index = 0;
	runtime.refs = [];
	runtime.result = { status: "ready" };
});
function render(change: ReturnType<typeof vi.fn>) {
	runtime.index = 0;
	return MinimapDisplay({
		audioData: EMPTY_AUDIO_DATA,
		viewStartFrac: 0.2,
		viewEndFrac: 0.4,
		waveformColor: [255, 255, 255],
		onScrubToFraction: change,
	}) as ReactElement<ComponentProps<"div">>;
}
function surface() {
	const captured = new Set<number>();
	return {
		focus: vi.fn(),
		getBoundingClientRect: () => ({ left: 100, width: 200 }),
		setPointerCapture: (id: number) => captured.add(id),
		hasPointerCapture: (id: number) => captured.has(id),
		releasePointerCapture: (id: number) => captured.delete(id),
	};
}
function event(target: ReturnType<typeof surface>, clientX: number, pointerId = 1) {
	return {
		currentTarget: target,
		clientX,
		pointerId,
		button: 0,
		preventDefault: vi.fn(),
	} as unknown as React.PointerEvent<HTMLDivElement>;
}

it("preserves the grab offset and drag geometry while ready pixels become held loading pixels", () => {
	const change = vi.fn();
	const target = surface();
	let view = render(change);
	view.props.onPointerDown?.(event(target, 150));
	expect(change.mock.calls[0]?.[0]).toBeCloseTo(0.3);
	expect(target.focus).toHaveBeenCalled();
	runtime.result = { status: "computing", previous: { status: "ready" } };
	target.getBoundingClientRect = () => ({ left: 0, width: 100 });
	view = render(change);
	view.props.onPointerMove?.(event(target, 190));
	expect(change.mock.lastCall?.[0]).toBeCloseTo(0.5);
	view.props.onPointerUp?.(event(target, 210));
	expect(change.mock.lastCall?.[0]).toBeCloseTo(0.6);
	expect(target.hasPointerCapture(1)).toBe(false);
	const count = change.mock.calls.length;
	view.props.onPointerMove?.(event(target, 240));
	expect(change).toHaveBeenCalledTimes(count);
});
it("accepts navigation during initial compute and ignores another pointer", () => {
	runtime.result = { status: "computing", previous: null };
	const change = vi.fn();
	const target = surface();
	const view = render(change);
	view.props.onPointerDown?.(event(target, 260));
	expect(change.mock.lastCall?.[0]).toBeCloseTo(0.8);
	view.props.onPointerMove?.(event(target, 290, 2));
	expect(change).toHaveBeenCalledTimes(1);
	view.props.onPointerMove?.(event(target, 400));
	expect(change.mock.lastCall?.[0]).toBeCloseTo(0.9);
});
it.each(["onPointerCancel", "onLostPointerCapture"] as const)(
	"cleans up %s without committing a later move",
	(handler) => {
		const change = vi.fn();
		const target = surface();
		const view = render(change);
		view.props.onPointerDown?.(event(target, 150));
		view.props[handler]?.(event(target, 190));
		view.props.onPointerMove?.(event(target, 250));
		expect(change).toHaveBeenCalledTimes(1);
	},
);
