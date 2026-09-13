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
	const stride = Math.max(1, Math.ceil(count / 2048));

	const selected: Array<number> = [];

	for (let start = 0; start < count; start += stride) {
		const end = Math.min(count, start + stride);
		let minimum = start;
		let maximum = start;
		let hasGap = false;

		for (let index = start; index < end; index++) {
			const value = values[index] ?? NaN;
			const minimumValue = values[minimum] ?? NaN;
			const maximumValue = values[maximum] ?? NaN;

			if (!Number.isFinite(value)) hasGap = true;

			if (value < minimumValue || !Number.isFinite(minimumValue)) minimum = index;

			if (value > maximumValue || !Number.isFinite(maximumValue)) maximum = index;
		}

		if (hasGap && stride > 1) {
			selected.push(-1, minimum, -1, maximum, -1);

			continue;
		}

		selected.push(...Array.from(new Set([start, minimum, maximum, end - 1])).sort((left, right) => left - right));
	}

	for (const index of selected) {
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
