
export function defaultCurtainPositions(count: number): Array<number> {
	return Array.from({ length: Math.max(0, count - 1) }, () => 1);
}

export function stripLeft(stripIndex: number, positions: ReadonlyArray<number>): number {
	return stripIndex === 0 ? 0 : (positions[stripIndex - 1] ?? 0);
}

export function stripRight(stripIndex: number, positions: ReadonlyArray<number>, count: number): number {
	return stripIndex === count - 1 ? 1 : (positions[stripIndex] ?? 1);
}

export function stripClipPath(stripIndex: number, positions: ReadonlyArray<number>, count: number): string {
	const left = stripLeft(stripIndex, positions);
	const right = stripRight(stripIndex, positions, count);

	return `inset(0 ${(1 - right) * 100}% 0 ${left * 100}%)`;
}

export function curtainBounds(
	curtainIndex: number,
	positions: ReadonlyArray<number>,
): { readonly min: number; readonly max: number } {
	return { min: positions[curtainIndex - 1] ?? 0, max: positions[curtainIndex + 1] ?? 1 };
}
