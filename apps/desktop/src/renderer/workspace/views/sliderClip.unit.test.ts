import { describe, expect, it } from "vitest";
import { curtainBounds, defaultCurtainPositions, stripClipPath } from "./sliderClip";

describe("defaultCurtainPositions", () => {
	it("returns N−1 curtains all at the right edge", () => {
		expect(defaultCurtainPositions(3)).toEqual([1, 1]);
	});

	it("returns an empty array below two sources", () => {
		expect(defaultCurtainPositions(1)).toEqual([]);
		expect(defaultCurtainPositions(0)).toEqual([]);
	});
});

describe("stripClipPath", () => {
	// Three sources, curtains at 0.25 and 0.6.
	const positions = [0.25, 0.6];
	const count = 3;

	it("clips the first strip from 0 to the first curtain", () => {
		// left = 0, right = 0.25 → right inset 75%, left inset 0%.
		expect(stripClipPath(0, positions, count)).toBe("inset(0 75% 0 0%)");
	});

	it("clips a middle strip between its two curtains", () => {
		// left = 0.25, right = 0.6 → right inset 40%, left inset 25%.
		expect(stripClipPath(1, positions, count)).toBe("inset(0 40% 0 25%)");
	});

	it("clips the last strip from its curtain to the right edge", () => {
		// left = 0.6, right = 1 → right inset 0%, left inset 60%.
		expect(stripClipPath(2, positions, count)).toBe("inset(0 0% 0 60%)");
	});

	it("shows the first source full-width when all curtains sit at the right edge", () => {
		const full = defaultCurtainPositions(count);

		expect(stripClipPath(0, full, count)).toBe("inset(0 0% 0 0%)");
		// A trailing strip is fully masked away (left inset 100%).
		expect(stripClipPath(1, full, count)).toBe("inset(0 0% 0 100%)");
	});
});

describe("curtainBounds", () => {
	const positions = [0.25, 0.6, 0.8];

	it("bounds the first curtain by 0 and its right neighbour", () => {
		expect(curtainBounds(0, positions)).toEqual({ min: 0, max: 0.6 });
	});

	it("bounds a middle curtain by both neighbours", () => {
		expect(curtainBounds(1, positions)).toEqual({ min: 0.25, max: 0.8 });
	});

	it("bounds the last curtain by its left neighbour and 1", () => {
		expect(curtainBounds(2, positions)).toEqual({ min: 0.6, max: 1 });
	});
});
