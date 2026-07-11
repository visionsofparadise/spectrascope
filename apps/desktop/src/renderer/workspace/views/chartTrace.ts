/**
 * Build polyline `points` strings from a time-series `Float32Array`. X defaults
 * to the sample index normalized into the `[0, 1]` viewBox by dividing by the
 * total count; a caller whose samples are not evenly spaced along X (e.g. LTAS
 * bands on a log-frequency axis) supplies `mapIndexToX` to place each sample.
 * Y is the sample mapped through the caller-supplied `mapValueToY` (which must
 * return a `[0, 1]` viewBox fraction). Non-finite samples (`NaN` / ±`Infinity`
 * — e.g. silence gaps a scan reports below an energy floor) start a fresh
 * sub-polyline so the gap reads as a break rather than a flat line.
 *
 * Shared by the chart-trace views (`LoudnessView`, `CorrelationView`,
 * `FrequencyDistributionView`) — the algorithm is identical across them; only
 * the value→Y mapping (and, for LTAS, the index→X placement) differs, so both
 * are passed in. A non-finite sample is left as a break by every caller, so the
 * fallback for a missing index is any non-finite value.
 */
export function buildPolylineSegments(
	values: Float32Array,
	mapValueToY: (value: number) => number,
	mapIndexToX?: (index: number) => number,
): Array<string> {
	const segments: Array<Array<string>> = [];
	let current: Array<string> = [];
	const count = values.length;

	if (count === 0) return [];

	const mapX = mapIndexToX ?? ((index: number) => index / (count - 1 || 1));

	for (let index = 0; index < count; index += 1) {
		const raw = values[index] ?? Number.NaN;

		if (!Number.isFinite(raw)) {
			if (current.length > 0) {
				segments.push(current);
				current = [];
			}

			continue;
		}

		const x = mapX(index);
		const y = mapValueToY(raw);

		current.push(`${x},${y}`);
	}

	if (current.length > 0) {
		segments.push(current);
	}

	return segments.map((segment) => segment.join(" "));
}
