import { FULL_FREQUENCY_RANGE } from "./frequencyRange";
import type { TextureVerticalRange } from "spectral-display";

function frequencyToMel(frequencyHz: number): number {
	return 2595 * Math.log10(1 + frequencyHz / 700);
}

export function frequencyToFraction(
	frequencyHz: number,
	sampleRate: number,
	range: TextureVerticalRange = FULL_FREQUENCY_RANGE,
): number {
	const minimum = frequencyToMel(20);
	const maximum = frequencyToMel(sampleRate / 2);

	return (1 - (frequencyToMel(frequencyHz) - minimum) / (maximum - minimum) - range.top) / (range.bottom - range.top);
}

export function fractionToFrequency(
	fraction: number,
	sampleRate: number,
	range: TextureVerticalRange = FULL_FREQUENCY_RANGE,
): number {
	const minimum = frequencyToMel(20);
	const maximum = frequencyToMel(sampleRate / 2);
	const fullFraction = range.top + Math.max(0, Math.min(1, fraction)) * (range.bottom - range.top);
	const mel = maximum - fullFraction * (maximum - minimum);

	return 700 * (Math.pow(10, mel / 2595) - 1);
}
