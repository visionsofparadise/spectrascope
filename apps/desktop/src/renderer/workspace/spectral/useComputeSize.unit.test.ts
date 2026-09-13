import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComputeSize } from "./useComputeSize";

const runtime = vi.hoisted(() => ({
	value: undefined as undefined | { width: number; height: number },
	effect: undefined as undefined | (() => void | (() => void)),
	cleanup: undefined as undefined | (() => void),
	dependencies: undefined as undefined | Array<unknown>,
	updates: 0,
}));

vi.mock("react", () => ({
	useState: (initial: { width: number; height: number }) => {
		runtime.value ??= initial;
		return [
			runtime.value,
			(value: typeof initial) => {
				runtime.value = value;
				runtime.updates += 1;
			},
		];
	},
	useEffect: (effect: () => void | (() => void), dependencies: Array<unknown>) => {
		if (dependencies.every((value, index) => Object.is(value, runtime.dependencies?.[index]))) return;
		runtime.cleanup?.();
		runtime.dependencies = dependencies;
		runtime.effect = effect;
	},
}));

function render(width: number, height: number) {
	const result = useComputeSize({ width, height });
	if (runtime.effect) {
		runtime.cleanup = runtime.effect() ?? undefined;
		runtime.effect = undefined;
	}
	return result;
}

beforeEach(() => {
	vi.useFakeTimers();
	runtime.value = undefined;
	runtime.effect = undefined;
	runtime.cleanup = undefined;
	runtime.dependencies = undefined;
	runtime.updates = 0;
});

afterEach(() => {
	runtime.cleanup?.();
	vi.useRealTimers();
});

describe("compute dimension scheduling", () => {
	it("uses the first dimensions immediately and coalesces a resize burst", () => {
		expect(render(800, 400)).toEqual({ width: 800, height: 400 });
		expect(render(850, 450)).toEqual({ width: 800, height: 400 });
		vi.advanceTimersByTime(100);
		expect(render(900, 500)).toEqual({ width: 800, height: 400 });
		vi.advanceTimersByTime(149);
		expect(runtime.updates).toBe(0);
		vi.advanceTimersByTime(1);
		expect(render(900, 500)).toEqual({ width: 900, height: 500 });
		expect(runtime.updates).toBe(1);
	});

	it("does not postpone a resize for an unrelated rerender", () => {
		render(800, 400);
		render(800, 500);
		vi.advanceTimersByTime(100);
		render(800, 500);
		vi.advanceTimersByTime(50);
		expect(runtime.value).toEqual({ width: 800, height: 500 });
	});

	it("cancels pending work when dimensions return or the display unmounts", () => {
		render(800, 400);
		render(900, 500);
		render(800, 400);
		vi.advanceTimersByTime(200);
		expect(runtime.updates).toBe(0);
		render(900, 500);
		runtime.cleanup?.();
		vi.advanceTimersByTime(200);
		expect(runtime.updates).toBe(0);
	});
});
