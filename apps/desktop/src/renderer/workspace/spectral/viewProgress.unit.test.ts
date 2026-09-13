import { expect, it } from "vitest";
import { clampedFractionOf, viewProgressOf } from "./viewProgress";

it.each([
	[-1, 0],
	[0.42, 0.42],
	[1.5, 1],
	[NaN, 0],
])("bounds progress %s to %s", (fraction, expected) => {
	expect(clampedFractionOf(fraction)).toBe(expected);
});

it("averages active view progress and is inactive with no reports", () => {
	expect(viewProgressOf([])).toEqual({ active: false, fraction: 0 });
	expect(viewProgressOf([0.2, 0.6])).toEqual({ active: true, fraction: 0.4 });
});
