
export function timeToFraction(ms: number | null, startMs: number, endMs: number): number | null {
	if (ms === null) return null;

	const span = endMs - startMs;

	if (span <= 0) return null;

	return (ms - startMs) / span;
}

export function eventToTime(
	event: { readonly clientX: number; readonly currentTarget: Element },
	startMs: number,
	endMs: number,
): number | null {
	const rect = event.currentTarget.getBoundingClientRect();

	if (rect.width <= 0) return null;

	const frac = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));

	return startMs + frac * (endMs - startMs);
}
