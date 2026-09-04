import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComputeResult } from "spectral-display";

/**
 * A source subcomponent's first-compute progress, reported up to its view. A
 * source is *first-computing* when it has no held previous result to show, so
 * the view overlays a shimmer + progress bar; a recompute (previous present)
 * reports `firstCompute: false` and shows the held render with no indicator.
 */
export interface ComputeState {
	readonly firstCompute: boolean;
	readonly fraction: number;
}

/**
 * Report a source subcomponent's compute state up to its view via
 * `onComputeState` — `{ firstCompute, fraction }` while computing, `null` once
 * settled (ready/idle/error) and on unmount. Reports from an effect, never
 * during render, so a child never sets parent state mid-render.
 */
export function useReportComputeState(
	sourceId: string,
	computeResult: ComputeResult,
	onComputeState?: (sourceId: string, state: ComputeState | null) => void,
): void {
	const computing = computeResult.status === "computing" ? computeResult : null;

	useEffect(() => {
		if (computing) {
			onComputeState?.(sourceId, {
				firstCompute: computing.previous === null,
				fraction: computing.fraction,
			});
		} else {
			onComputeState?.(sourceId, null);
		}

		return () => {
			onComputeState?.(sourceId, null);
		};
	}, [sourceId, computing, onComputeState]);
}

export interface FirstComputeProgress {
	/** Stable callback the source subcomponents report their compute state to. */
	readonly handleComputeState: (sourceId: string, state: ComputeState | null) => void;
	/** True while at least one reported source is first-computing (no held previous). */
	readonly firstComputing: boolean;
	/** Mean completion fraction across the first-computing sources (`0` when none). */
	readonly fraction: number;
}

/**
 * View-side aggregation of its source subcomponents' first-compute progress:
 * holds the per-source `ComputeState` map, and derives whether any source is
 * first-computing plus the mean fraction across those sources — the aggregate a
 * chart overlays as a single `ComputeProgress` bar.
 */
export function useFirstComputeProgress(): FirstComputeProgress {
	const [states, setStates] = useState<Map<string, ComputeState>>(() => new Map());

	const handleComputeState = useCallback((sourceId: string, state: ComputeState | null) => {
		setStates((prev) => {
			const next = new Map(prev);

			if (state === null) {
				next.delete(sourceId);
			} else {
				next.set(sourceId, state);
			}

			return next;
		});
	}, []);

	return useMemo(() => {
		const fractions = [...states.values()].filter((state) => state.firstCompute).map((state) => state.fraction);
		const firstComputing = fractions.length > 0;
		const fraction = firstComputing ? fractions.reduce((sum, value) => sum + value, 0) / fractions.length : 0;

		return { handleComputeState, firstComputing, fraction };
	}, [states, handleComputeState]);
}
