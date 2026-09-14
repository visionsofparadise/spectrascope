import { describe, expect, it } from "vitest";
import { loudnessStripValuesOf, stripLinePositionOf } from "./LoudnessView";
import type { LoudnessData } from "spectral-display";

function loudness(overrides: Partial<LoudnessData>): LoudnessData {
	return { integratedLufs: -14, peakDb: -1.5, truePeakDb: -0.8, ...overrides } as LoudnessData;
}

describe("loudness strips", () => {
	it("reads integrated loudness, true peak and sample peak", () => {
		expect(loudnessStripValuesOf(loudness({}))).toEqual({ integrated: -14, truePeak: -0.8, samplePeak: -1.5 });
	});

	it("falls back to the sample peak without a true peak", () => {
		expect(loudnessStripValuesOf(loudness({ truePeakDb: undefined })).truePeak).toBe(-1.5);
	});

	it("places lines on the shared axis and hides them outside the visible range", () => {
		expect(stripLinePositionOf(-10, -40, { start: 0, end: 1 })).toBe(0.25);
		expect(stripLinePositionOf(-10, -40, { start: 0, end: 0.5 })).toBe(0.5);
		expect(stripLinePositionOf(-30, -40, { start: 0, end: 0.5 })).toBeNull();
		expect(stripLinePositionOf(-Infinity, -40, { start: 0, end: 1 })).toBeNull();
	});

	it("hides a value below the axis floor instead of drawing it at the floor", () => {
		expect(stripLinePositionOf(-52, -40, { start: 0, end: 1 })).toBeNull();
		expect(stripLinePositionOf(-40, -40, { start: 0, end: 1 })).toBe(1);
	});

	it("hides a value above 0 dB instead of pinning it to the top", () => {
		expect(stripLinePositionOf(0.6, -40, { start: 0, end: 1 })).toBeNull();
		expect(stripLinePositionOf(0, -40, { start: 0, end: 1 })).toBe(0);
	});
});
