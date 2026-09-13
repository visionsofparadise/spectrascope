import { describe, expect, it } from "vitest";
import {
	axisFractionOf,
	constrainAxisRange,
	FULL_AXIS_RANGE,
	panAxisRange,
	resizeAxisRange,
	zoomAxisRange,
} from "./axisRange";

describe("axis range navigation", () => {
	it("recovers nonfinite ranges and clamps span and position into the full axis", () => {
		expect(constrainAxisRange({ start: NaN, end: 1 }, 0.1)).toBe(FULL_AXIS_RANGE);
		expect(constrainAxisRange({ start: -2, end: 2 }, 0.1)).toEqual({ start: 0, end: 1 });
		expect(constrainAxisRange({ start: 0.5, end: 0.52 }, 0.25)).toEqual({ start: 0.5, end: 0.75 });
		expect(constrainAxisRange({ start: 0.9, end: 0.95 }, 0.25)).toEqual({ start: 0.75, end: 1 });
	});
	it("pans while preserving span at both limits", () => {
		expect(panAxisRange({ start: 0.2, end: 0.6 }, -1, 0.1)).toEqual({ start: 0, end: 0.4 });
		const end = panAxisRange({ start: 0.2, end: 0.6 }, 1, 0.1);
		expect(end.start).toBeCloseTo(0.6);
		expect(end.end).toBe(1);
	});
	it("keeps the zoom anchor stationary and limits magnification", () => {
		const next = zoomAxisRange({ start: 0.2, end: 0.8 }, 0.5, 0.35, 0.1);
		expect(next.start + 0.25 * (next.end - next.start)).toBeCloseTo(0.35);
		expect(next.end - next.start).toBeCloseTo(0.3);
		const deep = zoomAxisRange(FULL_AXIS_RANGE, 0.00001, 0.5, 1 / 32);
		expect(deep.end - deep.start).toBeCloseTo(1 / 32);
		expect(zoomAxisRange({ start: 0.25, end: 0.75 }, 10, 0.5, 0.1)).toEqual(FULL_AXIS_RANGE);
	});
	it("keeps resized edges apart and inside the axis", () => {
		expect(resizeAxisRange({ start: 0.2, end: 0.4 }, "start", 0.8, 0.1).start).toBeCloseTo(0.3);
		expect(resizeAxisRange({ start: 0.2, end: 0.4 }, "end", 0, 0.1).end).toBeCloseTo(0.3);
		expect(resizeAxisRange({ start: 0.2, end: 0.4 }, "start", -1, 0.1)).toEqual({ start: 0, end: 0.4 });
		expect(resizeAxisRange({ start: 0.2, end: 0.4 }, "end", 2, 0.1)).toEqual({ start: 0.2, end: 1 });
	});
	it("maps full-axis fractions into the visible range", () => {
		expect(axisFractionOf(0.5, FULL_AXIS_RANGE)).toBe(0.5);
		expect(axisFractionOf(0.5, { start: 0.25, end: 0.75 })).toBe(0.5);
		expect(axisFractionOf(0, { start: 0.25, end: 0.75 })).toBe(-0.5);
		expect(axisFractionOf(1, { start: 0.25, end: 0.75 })).toBe(1.5);
	});
});
