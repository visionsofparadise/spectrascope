import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SelectionSurface } from "./SelectionSurface";
import type { ComponentProps, ReactElement } from "react";

const runtime = vi.hoisted(() => ({ index: 0, values: [] as Array<unknown> }));
const playback = vi.hoisted(() => ({
	positionSec: 0.5,
	durationSec: 1,
	selection: null as { start: number; end: number } | null,
	onSelectionChange: vi.fn<(selection: { start: number; end: number } | null) => void>(),
	onSeek: vi.fn<(position: number) => void>(),
}));

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
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
}));

vi.mock("../playback", () => ({ useWorkspacePlayback: () => playback }));

class SurfaceElement {
	readonly focus = vi.fn();
	readonly setPointerCapture = vi.fn();
	readonly hasPointerCapture = vi.fn(() => true);
	readonly releasePointerCapture = vi.fn();
	closest() {
		return this;
	}
	getBoundingClientRect() {
		return { left: 0, width: 100 };
	}
}

function surfaceProps(extra: Partial<ComponentProps<typeof SelectionSurface>> = {}) {
	runtime.index = 0;
	const element = SelectionSurface({ startMs: 0, endMs: 1000, ...extra }) as ReactElement<ComponentProps<"div">>;
	return element.props;
}

function keyboardEvent(surface: SurfaceElement, key: string, shiftKey = false, target: SurfaceElement = surface) {
	return {
		currentTarget: surface,
		target,
		key,
		shiftKey,
		isPrimary: true,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		defaultPrevented: false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	} as unknown as React.KeyboardEvent<HTMLDivElement>;
}

beforeEach(() => {
	runtime.index = 0;
	runtime.values = [];
	playback.positionSec = 0.5;
	playback.selection = null;
	playback.onSelectionChange.mockReset().mockImplementation((selection) => {
		playback.selection = selection;
	});
	playback.onSeek.mockReset();
	vi.stubGlobal("Element", SurfaceElement);
});

afterEach(() => vi.unstubAllGlobals());

describe("SelectionSurface gestures", () => {
	it("focuses a pointer selection and clears it with Escape", () => {
		const surface = new SurfaceElement();
		const down = {
			...keyboardEvent(surface, "", true),
			button: 0,
			pointerId: 1,
			clientX: 20,
		} as unknown as React.PointerEvent<HTMLDivElement>;
		surfaceProps().onPointerDown?.(down);
		expect(surface.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
		surfaceProps().onPointerUp?.({ ...down, clientX: 70 });
		expect(playback.selection).toEqual({ start: 200, end: 700 });
		surfaceProps().onKeyDown?.(keyboardEvent(surface, "Escape"));
		expect(playback.selection).toBeNull();
	});

	it("extends the left endpoint repeatedly without moving the keyboard anchor", () => {
		const surface = new SurfaceElement();
		for (let count = 0; count < 3; count++) surfaceProps().onKeyDown?.(keyboardEvent(surface, "ArrowLeft", true));
		expect(playback.selection).toEqual({ start: 470, end: 500 });
		surfaceProps().onKeyDown?.(keyboardEvent(surface, "ArrowRight", true));
		expect(playback.selection).toEqual({ start: 480, end: 500 });
	});

	it("ignores handled or nested-control keys", () => {
		const surface = new SurfaceElement();
		const delegated = vi.fn();
		const props = surfaceProps({ seekOnClick: true, onKeyDown: delegated });
		props.onKeyDown?.({ ...keyboardEvent(surface, "Escape"), defaultPrevented: true });
		props.onKeyDown?.(keyboardEvent(surface, "ArrowLeft", true, new SurfaceElement()));
		props.onKeyDown?.(keyboardEvent(surface, "ArrowRight", false, new SurfaceElement()));
		expect(playback.onSelectionChange).not.toHaveBeenCalled();
		expect(playback.onSeek).not.toHaveBeenCalled();
		expect(delegated).not.toHaveBeenCalled();
	});

	it.each([
		["ArrowLeft", 0.49],
		["ArrowRight", 0.51],
		["Home", 0],
		["End", 1],
	] as const)("seeks with %s", (key, expected) => {
		const surface = new SurfaceElement();
		surfaceProps({ seekOnClick: true }).onKeyDown?.(keyboardEvent(surface, key));
		expect(playback.onSeek).toHaveBeenCalledExactlyOnceWith(expected);
	});

	it("continues delegating ordinary inspection keys when seeking is disabled", () => {
		const delegated = vi.fn();
		const surface = new SurfaceElement();
		const event = keyboardEvent(surface, "ArrowRight");
		surfaceProps({ seekOnClick: false, onKeyDown: delegated }).onKeyDown?.(event);
		expect(delegated).toHaveBeenCalledExactlyOnceWith(event);
		expect(playback.onSeek).not.toHaveBeenCalled();
	});

	it("clears the range and seeks on an ordinary click", () => {
		const surface = new SurfaceElement();
		playback.selection = { start: 100, end: 300 };
		const event = { ...keyboardEvent(surface, ""), clientX: 75 } as unknown as React.MouseEvent<HTMLDivElement>;
		surfaceProps().onClick?.(event);
		expect(playback.onSelectionChange).toHaveBeenCalledExactlyOnceWith(null);
		expect(playback.onSeek).toHaveBeenCalledExactlyOnceWith(0.75);
		expect(playback.onSelectionChange.mock.invocationCallOrder[0]).toBeLessThan(
			playback.onSeek.mock.invocationCallOrder[0]!,
		);
	});

	it.each([
		[20, 70],
		[70, 20],
	])("selects an ordinary drag from %i to %i without a trailing seek", (from, to) => {
		const surface = new SurfaceElement();
		const down = {
			...keyboardEvent(surface, ""),
			button: 0,
			pointerId: 1,
			clientX: from,
		} as unknown as React.PointerEvent<HTMLDivElement>;
		surfaceProps().onPointerDown?.(down);
		surfaceProps().onPointerMove?.({ ...down, clientX: to });
		surfaceProps().onPointerUp?.({ ...down, clientX: to });
		surfaceProps().onLostPointerCapture?.(down);
		surfaceProps().onClick?.({ ...down, clientX: to });
		expect(playback.selection).toEqual({ start: 200, end: 700 });
		expect(playback.onSeek).not.toHaveBeenCalled();
		expect(surface.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
	});

	it("treats three pixels of pointer movement as a click", () => {
		const surface = new SurfaceElement();
		const down = {
			...keyboardEvent(surface, ""),
			button: 0,
			pointerId: 1,
			clientX: 20,
		} as unknown as React.PointerEvent<HTMLDivElement>;
		surfaceProps().onPointerDown?.(down);
		surfaceProps().onPointerMove?.({ ...down, clientX: 23 });
		surfaceProps().onPointerUp?.({ ...down, clientX: 23 });
		expect(playback.onSelectionChange).not.toHaveBeenCalled();
		surfaceProps().onClick?.({ ...down, clientX: 23 });
		expect(playback.onSeek).toHaveBeenCalledExactlyOnceWith(0.23);
	});

	it.each(["onPointerCancel", "onLostPointerCapture"] as const)("abandons a drag on %s", (cancel) => {
		const surface = new SurfaceElement();
		const down = {
			...keyboardEvent(surface, ""),
			button: 0,
			pointerId: 1,
			clientX: 20,
		} as unknown as React.PointerEvent<HTMLDivElement>;
		surfaceProps().onPointerDown?.(down);
		surfaceProps().onPointerMove?.({ ...down, clientX: 70 });
		surfaceProps()[cancel]?.(down);
		surfaceProps().onPointerUp?.({ ...down, clientX: 70 });
		surfaceProps().onClick?.({ ...down, clientX: 70 });
		expect(playback.onSelectionChange).not.toHaveBeenCalled();
		expect(playback.onSeek).not.toHaveBeenCalled();
	});

	it("leaves nested controls independent of display gestures", () => {
		const surface = new SurfaceElement();
		const down = {
			...keyboardEvent(surface, "", false, new SurfaceElement()),
			button: 0,
			pointerId: 1,
			clientX: 20,
		} as unknown as React.PointerEvent<HTMLDivElement>;
		surfaceProps().onPointerDown?.(down);
		surfaceProps().onPointerUp?.({ ...down, clientX: 70 });
		surfaceProps().onClick?.({ ...down, clientX: 70 });
		expect(surface.setPointerCapture).not.toHaveBeenCalled();
		expect(playback.onSelectionChange).not.toHaveBeenCalled();
		expect(playback.onSeek).not.toHaveBeenCalled();
	});
});
