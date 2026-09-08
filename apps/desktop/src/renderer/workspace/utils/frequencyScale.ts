import { frequencyToScalePosition, scalePositionToFrequency } from "spectral-display";
import { FULL_FREQUENCY_RANGE } from "./frequencyRange";
import type { FrequencyScale, TextureVerticalRange } from "spectral-display";

export function frequencyToFraction(
	frequencyHz: number,
	sampleRate: number,
	range: TextureVerticalRange = FULL_FREQUENCY_RANGE,
	scale: FrequencyScale = "mel",
): number {
	return (1 - frequencyToScalePosition(frequencyHz, sampleRate, scale) - range.top) / (range.bottom - range.top);
}

export function fractionToFrequency(
	fraction: number,
	sampleRate: number,
	range: TextureVerticalRange = FULL_FREQUENCY_RANGE,
	scale: FrequencyScale = "mel",
): number {
	const fullFraction = range.top + Math.max(0, Math.min(1, fraction)) * (range.bottom - range.top);

	return scalePositionToFrequency(1 - fullFraction, sampleRate, scale);
}
