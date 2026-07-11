import { describe, expect, it } from "vitest";
import { freqToX, magnitudeToDb } from "./FrequencyDistributionView";

describe("magnitudeToDb", () => {
	it("maps unit magnitude to 0 dB", () => {
		expect(magnitudeToDb(1)).toBeCloseTo(0, 10);
	});

	it("maps a tenth of unit magnitude to -20 dB", () => {
		expect(magnitudeToDb(0.1)).toBeCloseTo(-20, 10);
	});

	it("floors a zero-energy band at -200 dB instead of -Infinity", () => {
		expect(magnitudeToDb(0)).toBeCloseTo(-200, 10);
	});
});

describe("freqToX", () => {
	it("pins the axis endpoints to 0 and 1", () => {
		expect(freqToX(20)).toBeCloseTo(0, 10);
		expect(freqToX(20000)).toBeCloseTo(1, 10);
	});

	it("places a decade above the floor at one third of the log axis", () => {
		// 20 Hz → 20 kHz spans three decades; 200 Hz is one decade up.
		expect(freqToX(200)).toBeCloseTo(1 / 3, 10);
	});
});
