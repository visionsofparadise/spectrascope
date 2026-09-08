import { describe, expect, it } from "vitest";
import { extendSelection, normalizeSelection } from "./selection";

describe("normalizeSelection", () => {
	it("orders reversed gestures and clamps them to the comparison", () => {
		expect(normalizeSelection(1200, -100, 1000)).toEqual({ start: 0, end: 1000 });
		expect(normalizeSelection(800, 200, 1000)).toEqual({ start: 200, end: 800 });
	});
	it("clears empty, out-of-range and invalid selections", () => {
		expect(normalizeSelection(20, 20, 1000)).toBeNull();
		expect(normalizeSelection(1100, 1200, 1000)).toBeNull();
		expect(normalizeSelection(0, 10, 0)).toBeNull();
		expect(normalizeSelection(NaN, 10, 100)).toBeNull();
	});
});

describe("keyboard selection anchor", () => {
	it("extends left repeatedly from one fixed anchor and reverses across it", () => {
		let gesture = extendSelection(null, null, 500, -10, 1000);
		gesture = extendSelection(gesture, gesture.selection, 500, -10, 1000);
		gesture = extendSelection(gesture, gesture.selection, 500, -10, 1000);

		expect(gesture).toEqual({ anchor: 500, active: 470, selection: { start: 470, end: 500 } });
		gesture = extendSelection(gesture, gesture.selection, 500, 40, 1000);
		expect(gesture).toEqual({ anchor: 500, active: 510, selection: { start: 500, end: 510 } });
	});

	it("preserves the anchor when the active endpoint collapses onto it", () => {
		let gesture = extendSelection(null, null, 500, -10, 1000);
		gesture = extendSelection(gesture, gesture.selection, 500, 10, 1000);

		expect(gesture.selection).toBeNull();
		gesture = extendSelection(gesture, null, 800, 10, 1000);
		expect(gesture).toEqual({ anchor: 500, active: 510, selection: { start: 500, end: 510 } });
	});

	it("adopts an externally replaced selection and clamps repeated movement", () => {
		const previous = extendSelection(null, null, 500, -10, 1000);
		const gesture = extendSelection(previous, { start: 700, end: 900 }, 500, 200, 1000);

		expect(gesture).toEqual({ anchor: 700, active: 1000, selection: { start: 700, end: 1000 } });
		expect(extendSelection(gesture, gesture.selection, 500, 200, 1000)).toEqual(gesture);
	});
});
