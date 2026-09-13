import { describe, expect, it } from "vitest";
import { stripClipPath } from "./sliderClip";

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
		const full = [1, 1];

		expect(stripClipPath(0, full, count)).toBe("inset(0 0% 0 0%)");
		// A trailing strip is fully masked away (left inset 100%).
		expect(stripClipPath(1, full, count)).toBe("inset(0 0% 0 100%)");
	});
});
