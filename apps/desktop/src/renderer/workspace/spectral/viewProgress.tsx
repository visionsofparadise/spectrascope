import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";

type ReportViewProgress = (key: string, fraction: number | null) => void;

const ViewProgressContext = createContext<ReportViewProgress | null>(null);

export interface ViewProgress {
	readonly active: boolean;
	readonly fraction: number;
}

export function clampedFractionOf(fraction: number): number {
	return Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
}

export function viewProgressOf(fractions: ReadonlyArray<number>): ViewProgress {
	return {
		active: fractions.length > 0,
		fraction: fractions.length > 0 ? fractions.reduce((sum, value) => sum + value, 0) / fractions.length : 0,
	};
}

export function useViewProgressState(): { readonly report: ReportViewProgress; readonly progress: ViewProgress } {
	const [fractions, setFractions] = useState<ReadonlyMap<string, number>>(() => new Map());

	const report = useCallback<ReportViewProgress>((key, fraction) => {
		setFractions((previous) => {
			if (fraction === null ? !previous.has(key) : previous.get(key) === fraction) return previous;

			const next = new Map(previous);

			if (fraction === null) next.delete(key);
			else next.set(key, fraction);

			return next;
		});
	}, []);

	const progress = useMemo(() => viewProgressOf([...fractions.values()]), [fractions]);

	return { report, progress };
}

export function ViewProgressProvider({
	report,
	children,
}: {
	readonly report: ReportViewProgress;
	readonly children: React.ReactNode;
}) {
	return <ViewProgressContext.Provider value={report}>{children}</ViewProgressContext.Provider>;
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
