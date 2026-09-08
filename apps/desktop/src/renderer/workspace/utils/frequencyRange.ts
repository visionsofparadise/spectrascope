import type { TextureVerticalRange } from "spectral-display";

export const FULL_FREQUENCY_RANGE: TextureVerticalRange = { top: 0, bottom: 1 };
export const MIN_FREQUENCY_SPAN = 1 / 64;

export function constrainFrequencyRange(range: TextureVerticalRange): TextureVerticalRange {
	if (!Number.isFinite(range.top) || !Number.isFinite(range.bottom)) return FULL_FREQUENCY_RANGE;

	const span = Math.max(MIN_FREQUENCY_SPAN, Math.min(1, range.bottom - range.top));
	const top = Math.max(0, Math.min(1 - span, range.top));

	return { top, bottom: top + span };
}

export function panFrequencyRange(range: TextureVerticalRange, delta: number): TextureVerticalRange {
	return constrainFrequencyRange({ top: range.top + delta, bottom: range.bottom + delta });
}

export function zoomFrequencyRange(range: TextureVerticalRange, factor: number, anchor: number): TextureVerticalRange {
	const current = constrainFrequencyRange(range);
	const fraction = Math.max(0, Math.min(1, (anchor - current.top) / (current.bottom - current.top)));
	const span = Math.max(MIN_FREQUENCY_SPAN, Math.min(1, (current.bottom - current.top) * factor));
	const top = anchor - fraction * span;

	return constrainFrequencyRange({ top, bottom: top + span });
}

export function resizeFrequencyRange(
	range: TextureVerticalRange,
	edge: "top" | "bottom",
	position: number,
): TextureVerticalRange {
	return edge === "top"
		? { top: Math.max(0, Math.min(range.bottom - MIN_FREQUENCY_SPAN, position)), bottom: range.bottom }
		: { top: range.top, bottom: Math.min(1, Math.max(range.top + MIN_FREQUENCY_SPAN, position)) };
}
