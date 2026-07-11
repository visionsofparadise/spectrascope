/**
 * Pure clip/position math for the N-source Slider wipe. `positions` holds the
 * `N−1` curtain fractions in `[0, 1]`, ascending, one per adjacent-source
 * boundary; strip `stripIndex` occupies the band between curtain `stripIndex−1`
 * and curtain `stripIndex`, clipped two-sided so its visibility is geometric
 * (no z-order dependence).
 */

/** Default curtain positions for `count` sources — all at the right edge so source 1 fills the view. */
export function defaultCurtainPositions(count: number): Array<number> {
	return Array.from({ length: Math.max(0, count - 1) }, () => 1);
}

/** Left edge fraction of a strip: the curtain before it, or `0` for the first strip. */
export function stripLeft(stripIndex: number, positions: ReadonlyArray<number>): number {
	return stripIndex === 0 ? 0 : positions[stripIndex - 1] ?? 0;
}

/** Right edge fraction of a strip: the curtain after it, or `1` for the last strip. */
export function stripRight(stripIndex: number, positions: ReadonlyArray<number>, count: number): number {
	return stripIndex === count - 1 ? 1 : positions[stripIndex] ?? 1;
}

/**
 * `clipPath` for a strip — a two-sided horizontal inset masking everything
 * outside `[left, right]` so only that source's band shows.
 */
export function stripClipPath(stripIndex: number, positions: ReadonlyArray<number>, count: number): string {
	const left = stripLeft(stripIndex, positions);
	const right = stripRight(stripIndex, positions, count);

	return `inset(0 ${(1 - right) * 100}% 0 ${left * 100}%)`;
}

/**
 * Clamp bounds for a curtain — it cannot pass its neighbours, so `min` is the
 * curtain before it (`0` at the left end) and `max` is the curtain after it
 * (`1` at the right end). Fed to the `Curtain` primitive's `min`/`max`.
 */
export function curtainBounds(
	curtainIndex: number,
	positions: ReadonlyArray<number>,
): { readonly min: number; readonly max: number } {
	return { min: positions[curtainIndex - 1] ?? 0, max: positions[curtainIndex + 1] ?? 1 };
}
