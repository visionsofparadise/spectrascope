/**
 * Build polyline `points` strings from a time-series `Float32Array`. X is the
 * sample index normalized into the `[0, 1]` viewBox by dividing by the total
 * count; Y is the sample mapped through the caller-supplied `mapValueToY`
 * (which must return a `[0, 1]` viewBox fraction). Non-finite samples
 * (`NaN` / ±`Infinity` — e.g. silence gaps a scan reports below an energy
 * floor) start a fresh sub-polyline so the gap reads as a break rather than a
 * flat line.
 *
 * Shared by the chart-trace views (`LoudnessView`, `CorrelationView`) — the
 * algorithm is identical across them; only the value→Y mapping differs, so it
 * is passed in. A non-finite sample is left as a break by both callers, so the
 * fallback for a missing index is any non-finite value.
 */
export function buildPolylineSegments(
	values: Float32Array,
	mapValueToY: (value: number) => number,
): Array<string> {
	const segments: Array<Array<string>> = [];
	let current: Array<string> = [];
	const count = values.length;

	if (count === 0) return [];

	for (let index = 0; index < count; index += 1) {
		const raw = values[index] ?? Number.NaN;

		if (!Number.isFinite(raw)) {
			if (current.length > 0) {
				segments.push(current);
				current = [];
			}

			continue;
		}

		const x = index / (count - 1 || 1);
		const y = mapValueToY(raw);

		current.push(`${x},${y}`);
	}

	if (current.length > 0) {
		segments.push(current);
	}

	return segments.map((segment) => segment.join(" "));
}
