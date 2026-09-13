import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimeViewport } from "./useTimeViewport";

const runtime = vi.hoisted(() => ({ index: 0, values: [] as unknown[], effects: [] as Array<() => unknown> }));
vi.mock("react", () => ({
	useRef: (initial: unknown) => (runtime.values[runtime.index++] ??= { current: initial }),
	useState: (initial: unknown) => {
		const index = runtime.index++;
		if (!(index in runtime.values)) runtime.values[index] = initial;
		return [
			runtime.values[index],
			(next: unknown) => {
				runtime.values[index] = typeof next === "function" ? next(runtime.values[index]) : next;
			},
		];
	},
	useMemo: (factory: () => unknown) => factory(),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => unknown) => runtime.effects.push(effect),
}));

function render(frozen = false) {
	runtime.index = 0;
	return useTimeViewport(0, 10000, frozen);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("window", { setTimeout, clearTimeout });
	runtime.index = 0;
	runtime.values = [];
	runtime.effects = [];
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("viewport computation scheduling", () => {
	it("admits new tiles during sustained same-scale horizontal scrolling", () => {
		let viewport = render();
		viewport.setViewport({ startMs: 0, endMs: 1000 });
		vi.advanceTimersByTime(150);
		viewport = render();
		viewport.setViewport({ startMs: 100, endMs: 1100 });
		vi.advanceTimersByTime(50);
		viewport.setViewport({ startMs: 200, endMs: 1200 });
		vi.advanceTimersByTime(50);
		viewport.setViewport({ startMs: 300, endMs: 1300 });
		vi.advanceTimersByTime(50);
		viewport = render();
		expect(viewport.committedStartMs).toBe(300);
		viewport.setViewport({ startMs: 400, endMs: 1400 });
		vi.advanceTimersByTime(150);
		expect(render().committedStartMs).toBe(400);
	});

	it("waits for zoom changes to settle", () => {
		const viewport = render();
		viewport.setViewport({ startMs: 0, endMs: 5000 });
		vi.advanceTimersByTime(100);
		viewport.setViewport({ startMs: 0, endMs: 2500 });
		vi.advanceTimersByTime(100);
		expect(render().committedEndMs).toBe(10000);
		vi.advanceTimersByTime(50);
		expect(render().committedEndMs).toBe(2500);
	});

	it("holds requests during an explicit freeze", () => {
		const viewport = render(true);
		viewport.setViewport({ startMs: 500, endMs: 1500 });
		vi.advanceTimersByTime(1000);
		expect(render(true).committedStartMs).toBe(0);
	});
});
