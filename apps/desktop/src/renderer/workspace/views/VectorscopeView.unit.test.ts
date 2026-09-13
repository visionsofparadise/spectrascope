import { describe, expect, it } from "vitest";
import { canvasScaleOf, cloudTransformOf, crossLinePositionsOf, stereoReadoutRowsOf } from "./VectorscopeView";

describe("vectorscope range mapping", () => {
	it("scales and lifts the cloud by a half range", () => {
		expect(cloudTransformOf({ start: 0.5, end: 1 }, { start: 0.25, end: 0.75 })).toBe(
			"translate(-100%, -50%) scale(2, 2)",
		);
		expect(cloudTransformOf({ start: 0, end: 1 }, { start: 0, end: 1 })).toBe("translate(0%, 0%) scale(1, 1)");
	});

	it("places the cross lines within a half range and hides them outside it", () => {
		expect(crossLinePositionsOf({ start: 0.25, end: 0.75 }, { start: 0, end: 0.5 })).toEqual({ x: 0.5, y: 1 });
		expect(crossLinePositionsOf({ start: 0.6, end: 1 }, { start: 0.25, end: 0.75 })).toEqual({
			x: undefined,
			y: 0.5,
		});
		expect(crossLinePositionsOf({ start: 0, end: 0.5 }, { start: 0.6, end: 1 })).toEqual({ x: 1, y: undefined });
	});

	it("steps the canvas scale by powers of two up to the cap", () => {
		expect(canvasScaleOf(1, 1)).toBe(1);
		expect(canvasScaleOf(1, 0.9)).toBe(2);
		expect(canvasScaleOf(1, 0.5)).toBe(2);
		expect(canvasScaleOf(1, 0.3)).toBe(4);
		expect(canvasScaleOf(1.5, 0.3)).toBe(4);
		expect(canvasScaleOf(5, 0.25)).toBe(5);
	});
});

describe("vectorscope pointer readout", () => {
	it("derives channel levels and width from the pointer's side and mid position", () => {
		expect(stereoReadoutRowsOf(0.25, 0.25).map((row) => row.cursor)).toEqual(["-6.0 dB", "−∞ dB", "0.50"]);
		expect(stereoReadoutRowsOf(0, 0.5).map((row) => row.cursor)).toEqual(["-6.0 dB", "-6.0 dB", "0.00"]);
		expect(stereoReadoutRowsOf(0, 0).map((row) => row.cursor)).toEqual(["−∞ dB", "−∞ dB", "—"]);
		expect(stereoReadoutRowsOf(0.1, 0.3).every((row) => row.in === "—" && row.out === "—")).toBe(true);
	});
});
