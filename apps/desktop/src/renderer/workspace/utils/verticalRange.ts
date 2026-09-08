import { FULL_FREQUENCY_RANGE } from "./frequencyRange";
import type { TextureVerticalRange } from "spectral-display";

export function verticalFractionOf(fullFraction: number, range: TextureVerticalRange = FULL_FREQUENCY_RANGE): number {
	return (fullFraction - range.top) / (range.bottom - range.top);
}
