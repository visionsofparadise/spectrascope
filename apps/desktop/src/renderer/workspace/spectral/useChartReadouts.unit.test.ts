import { describe, expect, it } from "vitest";
import { nearestChartTrace } from "./useChartReadouts";
import type { ChartReadoutTrace } from "./useChartReadouts";

function trace(id: string, values: Float32Array | number): ChartReadoutTrace {
	return {
		sourceId: id,
		sourceName: id,
		values,
		query: { startMs: 100, endMs: 200 },
		valueToY: (value) => value,
		formatValue: String,
		amplitudeLabel: "Correlation r",
	};
}
describe("named chart source selection", () => {
	it("selects the nearest measured trace, not pointer-axis amplitude", () => {
		const low = trace("low", 0.2);
		const high = trace("high", 0.8);
		const traces = new Map([
			["low", low],
			["high", high],
		]);
		expect(nearestChartTrace(traces, 150, 0.7)).toBe(high);
		expect(nearestChartTrace(traces, 150, 0.3)).toBe(low);
	});
	it("ignores gaps and stale trace coverage", () => {
		const traces = new Map([["gap", trace("gap", new Float32Array([NaN, NaN]))]]);
		expect(nearestChartTrace(traces, 150, 0.5)).toBeUndefined();
		traces.set("known", trace("known", 0.5));
		expect(nearestChartTrace(traces, 300, 0.5)).toBeUndefined();
	});
});
