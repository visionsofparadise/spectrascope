import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollTrack } from "./ScrollTrack";
import type { ScrollTrackProps } from "./ScrollTrack";
import type { ComponentProps, ReactElement } from "react";

const runtime = vi.hoisted(() => ({
	index: 0,
	refs: [] as Array<{ current: unknown }>,
	effects: [] as Array<() => unknown>,
	stateIndex: 0,
	states: [] as Array<unknown>,
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useRef: (initial: unknown) => {
		const index = runtime.index++;
		return (runtime.refs[index] ??= { current: initial });
	},
	useState: (initial: unknown) => {
		const index = runtime.stateIndex++;
		if (!(index in runtime.states)) runtime.states[index] = initial;
		return [
			runtime.states[index],
			(value: unknown) => {
				runtime.states[index] = value;
			},
		];
	},
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => unknown) => {
		runtime.effects.push(effect);
	},
}));

type ButtonElement = ReactElement<ComponentProps<"button">>;

function buttons(node: unknown): Array<ButtonElement> {
	if (!node || typeof node !== "object") return [];
	if (Array.isArray(node)) return node.flatMap(buttons);
	const element = node as ReactElement<{ children?: unknown }>;
	return [...(element.type === "button" ? [element as ButtonElement] : []), ...buttons(element.props?.children)];
}

function render(axis: "x" | "y", change: ScrollTrackProps["onRangeChange"], range = { start: 0.25, end: 0.75 }) {
	runtime.index = 0;
	runtime.stateIndex = 0;
	runtime.effects = [];
	const tree = ScrollTrack({
		axis,
		range,
		minSpan: 0.1,
		label: "Level range",
		valueText: "-45 to -15 dB",
		edgeLabels: ["Upper level range", "Lower level range"],
		edgeValueTexts: ["-15 dB", "-45 dB"],
		onRangeChange: change,
	}) as ReactElement<ComponentProps<"div">>;
	const controls = buttons(tree);
	return {
		tree,
		thumb: controls.find((button) => button.props["aria-label"] === "Level range")!,
		upper: controls.find((button) => button.props["aria-label"] === "Upper level range")!,
		lower: controls.find((button) => button.props["aria-label"] === "Lower level range")!,
	};
}

function key(button: ButtonElement, keyName: string) {
	const event = { key: keyName, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
	button.props.onKeyDown?.(event as unknown as React.KeyboardEvent<HTMLButtonElement>);
	return event;
}

function pointer(clientX: number, clientY: number) {
	const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true };
	const event = {
		button: 0,
		pointerId: 1,
		clientX,
		clientY,
		currentTarget: target,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	} as unknown as React.PointerEvent<HTMLButtonElement>;
	return { event, target };
}

beforeEach(() => {
	runtime.refs = [];
	runtime.index = 0;
	runtime.states = [];
	runtime.stateIndex = 0;
	runtime.effects = [];
});

describe("scroll track", () => {
	it("renders an 8px void track with a raised thumb spanning the range", () => {
		const vertical = render("y", vi.fn());
		expect(vertical.tree.props.className).toContain("w-3");
		expect(vertical.tree.props.className).toContain("bg-void");
		expect(vertical.thumb.props.className).toContain("bg-chrome-raised");
		expect(vertical.thumb.props.style).toEqual({
			top: "clamp(0px, calc(50% - max(50%, 6px) / 2), calc(100% - max(50%, 6px)))",
			height: "max(50%, 6px)",
		});
		expect(vertical.thumb.props["aria-valuetext"]).toBe("-45 to -15 dB");
		expect(vertical.upper.props.className).toContain("cursor-ns-resize");
		expect(vertical.lower.props.style).toEqual({ top: "75%", transform: "translateY(-100%)" });
		const horizontal = render("x", vi.fn());
		expect(horizontal.tree.props.className).toContain("h-3");
		expect(horizontal.thumb.props.style).toEqual({
			left: "clamp(0px, calc(50% - max(50%, 6px) / 2), calc(100% - max(50%, 6px)))",
			width: "max(50%, 6px)",
		});
		expect(horizontal.upper.props.className).toContain("cursor-ew-resize");
		expect(horizontal.thumb.props["aria-orientation"]).toBe("horizontal");
	});
	it("pans the thumb and resizes an edge through captured pointer drags", () => {
		const change = vi.fn();
		const { thumb } = render("y", change);
		runtime.refs[0]!.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 8, height: 100 }) };
		const pan = pointer(0, 50);
		thumb.props.onPointerDown?.(pan.event);
		thumb.props.onPointerMove?.({ ...pan.event, clientY: 60 });
		expect(pan.target.focus).toHaveBeenCalled();
		expect(pan.target.setPointerCapture).toHaveBeenCalledWith(1);
		expect(change.mock.lastCall?.[0].start).toBeCloseTo(0.35);
		expect(change.mock.lastCall?.[0].end).toBeCloseTo(0.85);
		thumb.props.onPointerUp?.(pan.event);
		const { lower } = render("y", change);
		const resize = pointer(0, 75);
		lower.props.onPointerDown?.(resize.event);
		lower.props.onPointerMove?.({ ...resize.event, clientY: 30 });
		expect(change).toHaveBeenLastCalledWith({ start: 0.25, end: 0.35 });
	});
	it("pans along x from the pointer's horizontal position", () => {
		const change = vi.fn();
		const { thumb } = render("x", change);
		runtime.refs[0]!.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 8 }) };
		const pan = pointer(100, 999);
		thumb.props.onPointerDown?.(pan.event);
		thumb.props.onPointerMove?.({ ...pan.event, clientX: 50 });
		expect(change).toHaveBeenLastCalledWith({ start: 0, end: 0.5 });
	});
	it("zooms at the pointer with a non-passive wheel listener", () => {
		const change = vi.fn();
		render("y", change);
		const listeners = new Map<string, { handler: (event: WheelEvent) => void; options: unknown }>();
		runtime.refs[0]!.current = {
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 8, height: 100 }),
			addEventListener: (type: string, handler: (event: WheelEvent) => void, options: unknown) =>
				listeners.set(type, { handler, options }),
			removeEventListener: vi.fn(),
		};
		runtime.effects[0]?.();
		const wheel = listeners.get("wheel");
		const event = { deltaY: -100, clientX: 0, clientY: 25, preventDefault: vi.fn(), stopPropagation: vi.fn() };
		wheel?.handler(event as unknown as WheelEvent);
		expect(wheel?.options).toEqual({ passive: false });
		expect(event.preventDefault).toHaveBeenCalled();
		const next = change.mock.lastCall?.[0];
		const factor = Math.exp(-0.2);
		expect(next.end - next.start).toBeCloseTo(0.5 * factor);
		expect(next.start).toBeCloseTo(0.25);
	});
	it("maps arrow keys to the track axis and resets on Escape, 0 and double-click", () => {
		const change = vi.fn();
		const vertical = () => render("y", change);
		expect(key(vertical().thumb, "ArrowDown").preventDefault).toHaveBeenCalled();
		expect(change.mock.lastCall?.[0].start).toBeCloseTo(0.3);
		change.mockClear();
		expect(key(vertical().thumb, "ArrowRight").preventDefault).not.toHaveBeenCalled();
		expect(change).not.toHaveBeenCalled();
		key(vertical().thumb, "+");
		expect(change).toHaveBeenLastCalledWith({ start: 0.3, end: 0.7 });
		key(vertical().upper, "Home");
		expect(change).toHaveBeenLastCalledWith({ start: 0, end: 0.75 });
		key(vertical().lower, "End");
		expect(change).toHaveBeenLastCalledWith({ start: 0.25, end: 1 });
		key(vertical().thumb, "Escape");
		expect(change).toHaveBeenLastCalledWith({ start: 0, end: 1 });
		change.mockClear();
		const horizontal = () => render("x", change);
		key(horizontal().thumb, "ArrowLeft");
		expect(change.mock.lastCall?.[0].start).toBeCloseTo(0.2);
		expect(key(horizontal().thumb, "ArrowUp").preventDefault).not.toHaveBeenCalled();
		key(horizontal().thumb, "0");
		expect(change).toHaveBeenLastCalledWith({ start: 0, end: 1 });
		change.mockClear();
		horizontal().lower.props.onDoubleClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(change).toHaveBeenCalledWith({ start: 0, end: 1 });
	});
	it("accumulates rapid key steps before a re-render", () => {
		const change = vi.fn();
		const { thumb } = render("y", change);
		key(thumb, "ArrowDown");
		key(thumb, "ArrowDown");
		expect(change.mock.lastCall?.[0].start).toBeCloseTo(0.35);
	});
	it("accumulates rapid wheel steps before a re-render", () => {
		const change = vi.fn();
		render("y", change, { start: 0, end: 1 });
		let wheel: ((event: WheelEvent) => void) | undefined;
		runtime.refs[0]!.current = {
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 8, height: 100 }),
			addEventListener: (_type: string, handler: (event: WheelEvent) => void) => {
				wheel = handler;
			},
			removeEventListener: vi.fn(),
		};
		runtime.effects[0]?.();
		const event = { deltaY: -100, clientX: 0, clientY: 50, preventDefault: vi.fn(), stopPropagation: vi.fn() };
		wheel?.(event as unknown as WheelEvent);
		wheel?.(event as unknown as WheelEvent);
		const factor = Math.exp(-0.2);
		const [first, second] = change.mock.calls.map(([range]) => range);
		expect(first.end - first.start).toBeCloseTo(factor);
		expect(second.end - second.start).toBeCloseTo(factor * factor);
		expect((second.start + second.end) / 2).toBeCloseTo(0.5);
	});
	it("keeps a 6px thumb centred on a short range and hides edge zones below three edge lengths", () => {
		const range = { start: 0, end: 0.125 };
		runtime.states[0] = 64;
		const short = render("y", vi.fn(), range);
		expect(short.thumb.props.style).toEqual({
			top: "clamp(0px, calc(6.25% - max(12.5%, 6px) / 2), calc(100% - max(12.5%, 6px)))",
			height: "max(12.5%, 6px)",
		});
		expect(short.upper).toBeUndefined();
		expect(short.lower).toBeUndefined();
		runtime.states[0] = 72;
		const long = render("y", vi.fn(), range);
		expect(long.upper).toBeDefined();
		expect(long.lower).toBeDefined();
	});
	it("keeps a dragged edge zone while the thumb shrinks below three edge lengths", () => {
		runtime.states[0] = 64;
		runtime.states[1] = "end";
		const dragging = render("y", vi.fn(), { start: 0, end: 0.125 });
		expect(dragging.upper).toBeUndefined();
		expect(dragging.lower).toBeDefined();
	});
});
