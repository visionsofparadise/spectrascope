import { describe, expect, it } from "vitest";
import { valueTicksOf, visibleValueTicksOf } from "./valueTicks";

describe("value ticks", () => {
	it("matches the fixed full-range chart ticks", () => {
		expect(valueTicksOf(-60, 0, 8)).toEqual([0, -10, -20, -30, -40, -50, -60]);
		expect(valueTicksOf(-40, 0, 8)).toEqual([0, -5, -10, -15, -20, -25, -30, -35, -40]);
		expect(valueTicksOf(-1, 1, 5)).toEqual([1, 0.5, 0, -0.5, -1]);
		expect(valueTicksOf(-90, 0, 10)).toEqual([0, -10, -20, -30, -40, -50, -60, -70, -80, -90]);
	});
	it("uses finer 1·2·5 steps inside a narrow range without floating residue", () => {
		expect(valueTicksOf(-24, -6, 8)).toEqual([-10, -15, -20]);
		expect(valueTicksOf(0.1, 0.35, 5)).toEqual([0.35, 0.3, 0.25, 0.2, 0.15, 0.1]);
		expect(Object.is(valueTicksOf(-1, 1, 5)[2], 0)).toBe(true);
	});
	it("returns no ticks for an empty or invalid range", () => {
		expect(valueTicksOf(0, 0, 8)).toEqual([]);
		expect(valueTicksOf(0, NaN, 8)).toEqual([]);
	});
	it("derives the visible value range from a top-down axis range", () => {
		expect(visibleValueTicksOf(-60, 0, { start: 0, end: 1 }, 8)).toEqual(valueTicksOf(-60, 0, 8));
		expect(visibleValueTicksOf(-60, 0, { start: 0.1, end: 0.4 }, 8)).toEqual([-10, -15, -20]);
	});
});
