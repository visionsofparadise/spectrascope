import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toSourceState } from "../comparison/createComparison";
import { ComparisonHistory, classifyEdit, toHistoryState } from "./comparisonHistory";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState, Comparison } from "../models/State/App";
import type { Snapshot } from "valtio/vanilla";

export interface HistoryControl {
	readonly undo: () => void;
	readonly redo: () => void;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}

export function useComparisonHistory(
	comparison: Snapshot<Comparison>,
	app: Snapshot<AppState>,
	appStore: ProxyStore,
): HistoryControl {
	const history = useMemo(() => new ComparisonHistory(toHistoryState(comparison)), [comparison.id]);

	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);

	const syncFlags = useCallback(() => {
		setCanUndo(history.canUndo);
		setCanRedo(history.canRedo);
	}, [history]);

	const suppressNextPushRef = useRef(false);

	const lastStateRef = useRef(toHistoryState(comparison));

	useEffect(() => {
		const next = toHistoryState(comparison);
		const previous = lastStateRef.current;

		lastStateRef.current = next;

		if (suppressNextPushRef.current) {
			suppressNextPushRef.current = false;

			return;
		}

		history.push(next, classifyEdit(previous, next));
		syncFlags();
	}, [comparison, history, syncFlags]);

	const restore = useCallback(
		(state: ReturnType<typeof toHistoryState>) => {
			suppressNextPushRef.current = true;

			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.sources = state.sources.map((source) => toSourceState(source));
				target.activeView = state.activeView;
				target.channelInput = state.channelInput;
				target.selection =
					state.selection === null ? null : { start: state.selection.start, end: state.selection.end };
				target.canonicalSampleRate = state.canonicalSampleRate;
				target.differenceA = state.differenceA;
				target.differenceB = state.differenceB;
			});
		},
		[app, appStore, comparison.id],
	);

	const undo = useCallback(() => {
		const restored = history.undo();

		if (restored === null) return;

		restore(restored);
		syncFlags();
	}, [history, restore, syncFlags]);

	const redo = useCallback(() => {
		const restored = history.redo();

		if (restored === null) return;

		restore(restored);
		syncFlags();
	}, [history, restore, syncFlags]);

	return { undo, redo, canUndo, canRedo };
}
