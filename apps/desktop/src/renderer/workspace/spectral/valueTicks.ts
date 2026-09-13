import type { AxisRange } from "../utils/axisRange";

const TICK_EPSILON = 1e-9;

export function valueTicksOf(min: number, max: number, targetCount: number): ReadonlyArray<number> {
	const span = max - min;

	if (!Number.isFinite(span) || span <= 0 || targetCount <= 0) return [];

	const target = span / targetCount;
	const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
	const normalized = target / magnitude;
	const factor =
		normalized <= 1 + TICK_EPSILON ? 1 : normalized <= 2 + TICK_EPSILON ? 2 : normalized <= 5 + TICK_EPSILON ? 5 : 10;
	const step = factor * magnitude;
	const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
	const ticks: Array<number> = [];

	for (let index = Math.floor(max / step + TICK_EPSILON); index * step >= min - step * TICK_EPSILON; index--) {
		ticks.push(Number((index * step).toFixed(decimals)) + 0);
	}

	return ticks;
}

export function visibleValueTicksOf(
	min: number,
	max: number,
	range: AxisRange,
	targetCount: number,
): ReadonlyArray<number> {
	const span = max - min;

	return valueTicksOf(max - range.end * span, max - range.start * span, targetCount);
}
