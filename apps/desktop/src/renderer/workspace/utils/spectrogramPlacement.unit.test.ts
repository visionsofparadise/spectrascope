import { describe, expect, it } from "vitest";
import { spectrogramPlacement } from "./spectrogramPlacement";
import { frequencyToFraction } from "./frequencyScale";

describe("native spectrum placement", () => {
	it.each(["linear", "log", "mel", "erb"] as const)("aligns actual frequencies in the %s display domain", (scale) => {
		for (const range of [
			{ top: 0, bottom: 1 },
			{ top: 0.1, bottom: 0.8 },
		]) {
			const placement = spectrogramPlacement(44100, 96000, range, scale);
			expect(placement.visible).toBe(true);
			expect(placement.top).toBeGreaterThanOrEqual(0);
			const frequency = 10000;
			const nativePosition = frequencyToFraction(frequency, 44100, placement.range, scale);
			expect(placement.top + nativePosition * placement.height).toBeCloseTo(
				frequencyToFraction(frequency, 96000, range, scale),
				10,
			);
			expect(placement.range.top).toBeGreaterThanOrEqual(0);
			expect(placement.range.bottom).toBeLessThanOrEqual(1);
		}
	});
	it.each(["linear", "log", "mel", "erb"] as const)("leaves %s regions above native Nyquist empty", (scale) => {
		const nativeTop = frequencyToFraction(22050, 96000, undefined, scale);
		expect(spectrogramPlacement(44100, 96000, { top: 0, bottom: nativeTop / 2 }, scale).visible).toBe(false);
	});
	it("preserves existing placement when native and display rates match", () => {
		const range = { top: 0.2, bottom: 0.7 };
		expect(spectrogramPlacement(48000, 48000, range)).toEqual({ top: 0, height: 1, range, visible: true });
	});
});
