export interface AxisRange {
	readonly start: number;
	readonly end: number;
}

export const FULL_AXIS_RANGE: AxisRange = { start: 0, end: 1 };

export function constrainAxisRange(range: AxisRange, minSpan: number): AxisRange {
	if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) return FULL_AXIS_RANGE;

	const span = Math.max(minSpan, Math.min(1, range.end - range.start));
	const start = Math.max(0, Math.min(1 - span, range.start));

	return { start, end: start + span };
}

export function panAxisRange(range: AxisRange, delta: number, minSpan: number): AxisRange {
	return constrainAxisRange({ start: range.start + delta, end: range.end + delta }, minSpan);
}

export function zoomAxisRange(range: AxisRange, factor: number, anchor: number, minSpan: number): AxisRange {
	const current = constrainAxisRange(range, minSpan);
	const fraction = Math.max(0, Math.min(1, (anchor - current.start) / (current.end - current.start)));
	const span = Math.max(minSpan, Math.min(1, (current.end - current.start) * factor));
	const start = anchor - fraction * span;

	return constrainAxisRange({ start, end: start + span }, minSpan);
}

export function resizeAxisRange(range: AxisRange, edge: "start" | "end", position: number, minSpan: number): AxisRange {
	return edge === "start"
		? { start: Math.max(0, Math.min(range.end - minSpan, position)), end: range.end }
		: { start: range.start, end: Math.min(1, Math.max(range.start + minSpan, position)) };
}

export function axisFractionOf(fullFraction: number, range: AxisRange): number {
	return (fullFraction - range.start) / (range.end - range.start);
}
