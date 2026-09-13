import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { ViewLoadingToast } from "./ViewLoadingToast";

type ReportViewProgress = (key: string, fraction: number | null) => void;

const ViewProgressContext = createContext<ReportViewProgress | null>(null);

export interface ViewProgress {
	readonly active: boolean;
	readonly fraction: number;
}

const ViewProgressStateContext = createContext<ViewProgress>({ active: false, fraction: 0 });

export function clampedFractionOf(fraction: number): number {
	return Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
}

export function viewProgressOf(fractions: ReadonlyArray<number>): ViewProgress {
	return {
		active: fractions.length > 0,
		fraction: fractions.length > 0 ? fractions.reduce((sum, value) => sum + value, 0) / fractions.length : 0,
	};
}

function useViewProgressState(): { readonly report: ReportViewProgress; readonly progress: ViewProgress } {
	const reportToParent = useContext(ViewProgressContext);
	const [fractions, setFractions] = useState<ReadonlyMap<string, number>>(() => new Map());

	const report = useCallback<ReportViewProgress>(
		(key, fraction) => {
			reportToParent?.(key, fraction);
			setFractions((previous) => {
				if (fraction === null ? !previous.has(key) : previous.get(key) === fraction) return previous;

				const next = new Map(previous);

				if (fraction === null) next.delete(key);
				else next.set(key, fraction);

				return next;
			});
		},
		[reportToParent],
	);

	const progress = useMemo(() => viewProgressOf([...fractions.values()]), [fractions]);

	return { report, progress };
}

export function ViewProgressProvider({ children }: { readonly children: React.ReactNode }) {
	const { report, progress } = useViewProgressState();

	return (
		<ViewProgressContext.Provider value={report}>
			<ViewProgressStateContext.Provider value={progress}>{children}</ViewProgressStateContext.Provider>
		</ViewProgressContext.Provider>
	);
}

export function ViewProgressToast({ color }: { readonly color?: string }) {
	const progress = useContext(ViewProgressStateContext);

	return progress.active ? <ViewLoadingToast label="Rendering" color={color} /> : null;
}

export function useReportViewProgress(fraction: number): void {
	const report = useContext(ViewProgressContext);
	const key = useId();
	const clamped = clampedFractionOf(fraction);

	useEffect(() => {
		report?.(key, clamped);
	}, [report, key, clamped]);

	useEffect(() => () => report?.(key, null), [report, key]);
}
