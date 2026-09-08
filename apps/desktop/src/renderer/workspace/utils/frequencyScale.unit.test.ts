import { describe, expect, it } from "vitest";
import { fractionToFrequency, frequencyToFraction } from "./frequencyScale";

describe("Mel display coordinates", () => {
	it.each([8000, 44100, 48000, 96000])("maps 20Hz and Nyquist to display edges at %iHz", (sampleRate) => {
		expect(frequencyToFraction(20, sampleRate)).toBeCloseTo(1);
		expect(frequencyToFraction(sampleRate / 2, sampleRate)).toBeCloseTo(0);
		expect(fractionToFrequency(1, sampleRate)).toBeCloseTo(20);
		expect(fractionToFrequency(0, sampleRate)).toBeCloseTo(sampleRate / 2);
	});

	it.each([20, 100, 1000, 5000, 20000])("round-trips %iHz through axis and hover coordinates", (frequencyHz) => {
		expect(fractionToFrequency(frequencyToFraction(frequencyHz, 48000), 48000)).toBeCloseTo(frequencyHz);
	});

	it("clamps pointer positions to the displayed frequency range", () => {
		expect(fractionToFrequency(-1, 48000)).toBeCloseTo(24000);
		expect(fractionToFrequency(2, 48000)).toBeCloseTo(20);
	});
});
