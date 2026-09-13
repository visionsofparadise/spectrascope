import type { Source } from "../source";

export interface SourcePair {
	readonly a: string | null;
	readonly b: string | null;
}

export function sourcePairOf(
	sources: ReadonlyArray<Pick<Source, "id">>,
	selectedA: string | null,
	selectedB: string | null,
): SourcePair {
	const ids = new Set(sources.map((source) => source.id));
	const resolvedA = selectedA !== null && ids.has(selectedA) ? selectedA : (sources[0]?.id ?? null);

	if (sources.length < 2) return { a: resolvedA, b: null };

	const resolvedB =
		selectedB !== null && ids.has(selectedB)
			? selectedB
			: (sources.find((source) => source.id !== resolvedA)?.id ?? null);

	return { a: resolvedA, b: resolvedB };
}
