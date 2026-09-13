import { describe, expect, it } from "vitest";
import { freqToX, frequencyReadoutRowsOf, magnitudeToDb, xToFreq } from "./FrequencyDistributionView";

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

describe("xToFreq", () => {
	it("inverts the log frequency axis for scroll track values", () => {
		expect(xToFreq(0)).toBeCloseTo(20, 10);
		expect(xToFreq(1)).toBeCloseTo(20000, 6);
		expect(xToFreq(freqToX(1000))).toBeCloseTo(1000, 6);
	});
});

describe("frequencyReadoutRowsOf", () => {
	it("shows dashes for every value without a pointer", () => {
		expect(frequencyReadoutRowsOf(null)).toEqual([
			{ label: "Freq", cursor: "—", in: "—", out: "—" },
			{ label: "Amp", cursor: "—", in: "—", out: "—" },
		]);
	});

	it("reads hertz below 1 kHz and the level from the pointer height", () => {
		const [freq, amp] = frequencyReadoutRowsOf({ x: freqToX(200), y: 0.5 });
		expect(freq?.cursor).toBe("200 Hz");
		expect(amp?.cursor).toBe("-45.0 dB");
	});

	it("reads kilohertz from 1 kHz up", () => {
		const [freq, amp] = frequencyReadoutRowsOf({ x: freqToX(2500), y: 0 });
		expect(freq?.cursor).toBe("2.5 kHz");
		expect(amp?.cursor).toBe("0.0 dB");
	});
});
