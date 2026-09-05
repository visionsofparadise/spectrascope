import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComputeResult } from "spectral-display";

export interface ComputeState {
	readonly firstCompute: boolean;
	readonly fraction: number;
}

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
	readonly handleComputeState: (sourceId: string, state: ComputeState | null) => void;
	readonly firstComputing: boolean;
	readonly fraction: number;
}

export function useFirstComputeProgress(): FirstComputeProgress {
	const [states, setStates] = useState<Map<string, ComputeState>>(() => new Map());

	const handleComputeState = useCallback((sourceId: string, state: ComputeState | null) => {
		setStates((previous) => {
			const next = new Map(previous);

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
