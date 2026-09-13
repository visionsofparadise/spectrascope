import type { ComputeResultReady } from "spectral-display";

export function tileCoverageMask(
	result: ComputeResultReady,
	newer: ReadonlyArray<ComputeResultReady>,
): string | undefined {
	const start = result.query.startMs;
	const end = result.query.endMs;
	const span = end - start;

	if (span <= 0) return "linear-gradient(transparent, transparent)";

	let segments: Array<readonly [number, number]> = [[start, end]];

	for (const replacement of newer) {
		const left = replacement.query.startMs;
		const right = replacement.query.endMs;

		segments = segments.flatMap(([segmentStart, segmentEnd]) => {
			if (right <= segmentStart || left >= segmentEnd) return [[segmentStart, segmentEnd] as const];

			const remaining: Array<readonly [number, number]> = [];

			if (left > segmentStart) remaining.push([segmentStart, left]);

			if (right < segmentEnd) remaining.push([right, segmentEnd]);

			return remaining;
		});
	}

	if (segments.length === 1 && segments[0]?.[0] === start && segments[0][1] === end) return undefined;

	if (segments.length === 0) return "linear-gradient(transparent, transparent)";

	const stops = ["transparent 0%"];

	for (const [left, right] of segments) {
		const leftPercent = ((left - start) / span) * 100;
		const rightPercent = ((right - start) / span) * 100;

		stops.push(
			`transparent ${leftPercent}%`,
			`black ${leftPercent}%`,
			`black ${rightPercent}%`,
			`transparent ${rightPercent}%`,
		);
	}

	stops.push("transparent 100%");

	return `linear-gradient(to right, ${stops.join(", ")})`;
}
