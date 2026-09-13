import { axisFractionOf } from "./axisRange";
import { FULL_FREQUENCY_RANGE } from "./frequencyRange";
import type { TextureVerticalRange } from "spectral-display";

export function verticalFractionOf(fullFraction: number, range: TextureVerticalRange = FULL_FREQUENCY_RANGE): number {
	return axisFractionOf(fullFraction, { start: range.top, end: range.bottom });
}
