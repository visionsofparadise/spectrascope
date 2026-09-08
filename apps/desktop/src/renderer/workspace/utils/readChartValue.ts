import type { TimeWindow } from "../useTimeViewport";

export function readChartValue(values: Float32Array | number, query: TimeWindow, timeMs: number): number | null {
	if (!Number.isFinite(timeMs) || timeMs < query.startMs || timeMs > query.endMs || query.endMs <= query.startMs)
		return null;

	if (typeof values === "number") return Number.isNaN(values) ? null : values;

	if (values.length === 0) return null;

	const position = ((timeMs - query.startMs) / (query.endMs - query.startMs)) * (values.length - 1);
	const lower = Math.floor(position);
	const left = values[lower];

	if (left === undefined || Number.isNaN(left)) return null;

	if (position === lower) return left;

	const right = values[Math.min(values.length - 1, lower + 1)];

	if (right === undefined || Number.isNaN(right)) return null;

	if (left === right) return left;

	if (!Number.isFinite(left) || !Number.isFinite(right)) return null;

	return left + (right - left) * (position - lower);
}
