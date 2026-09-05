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
