import { constrainAxisRange } from "./axisRange";
import type { TextureVerticalRange } from "spectral-display";

export const FULL_FREQUENCY_RANGE: TextureVerticalRange = { top: 0, bottom: 1 };
export const MIN_FREQUENCY_SPAN = 1 / 64;

export function constrainFrequencyRange(range: TextureVerticalRange): TextureVerticalRange {
	const constrained = constrainAxisRange({ start: range.top, end: range.bottom }, MIN_FREQUENCY_SPAN);

	return { top: constrained.start, bottom: constrained.end };
}
