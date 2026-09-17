import { describe, expect, it } from "vitest";
import { readChartValue } from "./readChartValue";

const query = { startMs: 2000, endMs: 4000 };
describe("displayed chart measurements", () => {
	it("interpolates the rendered trace at absolute session time", () => {
		expect(readChartValue(new Float32Array([-20, -40, -10]), query, 2500)).toBe(-30);
		expect(readChartValue(new Float32Array([-20, -40, -10]), query, 4000)).toBe(-10);
	});
	it("leaves gaps and uncovered time unavailable", () => {
		expect(readChartValue(new Float32Array([0, 1, NaN]), { startMs: 0, endMs: 2 }, 1)).toBe(1);
		expect(readChartValue(new Float32Array([0, 1, NaN]), { startMs: 0, endMs: 2 }, 1.5)).toBeNull();
		expect(readChartValue(new Float32Array([1, NaN, -1]), query, 2500)).toBeNull();
		expect(readChartValue(2, query, 1000)).toBeNull();
		expect(readChartValue(new Float32Array(), query, 2500)).toBeNull();
	});
	it("keeps scalar measurements constant within the held window", () => {
		expect(readChartValue(-14, query, 2100)).toBe(-14);
		expect(readChartValue(-14, query, 3900)).toBe(-14);
	});
	it("preserves silence without inventing finite interpolation", () => {
		expect(readChartValue(new Float32Array([-Infinity, -Infinity]), query, 2500)).toBe(-Infinity);
		expect(readChartValue(new Float32Array([-Infinity, -20]), query, 2500)).toBeNull();
	});
});
