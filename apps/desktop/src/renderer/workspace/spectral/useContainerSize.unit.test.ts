import { afterEach, describe, expect, it, vi } from "vitest";
import { physicalSizeOf, useContainerSize } from "./useContainerSize";

const runtime = vi.hoisted(() => ({
	value: { width: 0, height: 0 },
	effect: undefined as undefined | (() => void | (() => void)),
}));
vi.mock("react", () => ({
	useState: (initial: () => { width: number; height: number }) => {
		runtime.value = initial();
		return [
			runtime.value,
			(update: (previous: typeof runtime.value) => typeof runtime.value) => {
				runtime.value = update(runtime.value);
			},
		];
	},
	useEffect: (effect: () => void | (() => void)) => {
		runtime.effect = effect;
	},
}));
afterEach(() => vi.unstubAllGlobals());
describe("physical canvas measurements", () => {
	it("multiplies by DPR once and rounds physical pixels", () => {
		expect(physicalSizeOf(320.2, 200.4, 1.5)).toEqual({ width: 480, height: 301 });
		expect(physicalSizeOf(320, 200, NaN)).toEqual({ width: 320, height: 200 });
	});
	it("updates backing size on DPI changes without a CSS resize and cleans listeners", () => {
		let resize: ((entries: Array<{ contentRect: { width: number; height: number } }>) => void) | undefined;
		let ratioChange: (() => void) | undefined;
		const disconnect = vi.fn();
		const remove = vi.fn();
		const host = {
			devicePixelRatio: 1,
			matchMedia: vi.fn(() => ({
				addEventListener: (_name: string, callback: () => void) => {
					ratioChange = callback;
				},
				removeEventListener: remove,
			})),
		};
		vi.stubGlobal("window", host);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: typeof resize) {
					resize = callback;
				}
				observe() {}
				disconnect = disconnect;
			},
		);
		useContainerSize(
			{ current: { clientWidth: 300, clientHeight: 200 } as HTMLDivElement },
			{ width: 800, height: 400 },
		);
		const cleanup = runtime.effect?.();
		expect(runtime.value).toEqual({ width: 300, height: 200 });
		host.devicePixelRatio = 2;
		ratioChange?.();
		expect(runtime.value).toEqual({ width: 600, height: 400 });
		resize?.([{ contentRect: { width: 150, height: 100 } }]);
		expect(runtime.value).toEqual({ width: 300, height: 200 });
		cleanup?.();
		expect(disconnect).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalled();
	});
});
