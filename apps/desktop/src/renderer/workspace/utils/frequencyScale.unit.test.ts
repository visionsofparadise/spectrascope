import { describe, expect, it } from "vitest";
import { fractionToFrequency, frequencyToFraction } from "./frequencyScale";

describe("Mel display coordinates", () => {
	it.each(["linear", "log", "mel", "erb"] as const)(
		"keeps %s cropped display, hover and out-of-range ticks consistent",
		(scale) => {
			const range = { top: 0.1, bottom: 0.75 };
			for (const fraction of [0, 0.3, 1]) {
				const frequency = fractionToFrequency(fraction, 44100, range, scale);
				expect(frequencyToFraction(frequency, 44100, range, scale)).toBeCloseTo(fraction);
			}
			expect(frequencyToFraction(30000, 44100, undefined, scale)).toBeLessThan(0);
			expect(fractionToFrequency(1, 44100, undefined, scale)).toBeCloseTo(scale === "linear" ? 0 : 20);
		},
	);
	it("maps a cropped spectrum consistently between axes and hover", () => {
		const range = { top: 0.2, bottom: 0.6 };
		const upper = fractionToFrequency(0.2, 48000);
		const lower = fractionToFrequency(0.6, 48000);
		expect(frequencyToFraction(upper, 48000, range)).toBeCloseTo(0);
		expect(frequencyToFraction(lower, 48000, range)).toBeCloseTo(1);
		expect(fractionToFrequency(0, 48000, range)).toBeCloseTo(upper);
		expect(fractionToFrequency(1, 48000, range)).toBeCloseTo(lower);
	});
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
