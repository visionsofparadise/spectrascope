import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState, Comparison } from "../models/State/App";
import { ComparisonHistory, classifyEdit, toHistoryState } from "./comparisonHistory";

/** What `useComparisonHistory` exposes — bind these to the actions-cluster buttons and keyboard shortcuts. */
export interface UseComparisonHistoryResult {
	/** Restore the previous comparison edit. No-op when `canUndo` is false. */
	readonly undo: () => void;
	/** Restore the next comparison edit. No-op when `canRedo` is false. */
	readonly redo: () => void;
	/** Whether there is a prior edit to undo to. */
	readonly canUndo: boolean;
	/** Whether there is a forward edit to redo to. */
	readonly canRedo: boolean;
}

/**
 * Back the actions-cluster undo/redo controls with a bounded history of
 * comparison-state snapshots.
 *
 * The comparison's state lives in the valtio `ProxyStore`; this hook observes
 * the deeply-immutable `comparison` snapshot prop the host already receives.
 * Valtio yields a fresh snapshot reference only when something actually
 * changed, so a changed reference is the change signal — no diffing of the
 * store internals is needed.
 *
 * On each history-relevant change (the snapshot minus the transient
 * `positionSec` — the playhead moving during playback is not an edit) the hook
 * `push()`es a `ComparisonHistory` entry, coalescing rapid same-kind edits.
 * `undo()`/`redo()` write the restored state straight back into the live proxy
 * via `appStore.mutate`. The restore itself produces a new snapshot, which
 * would otherwise look like a fresh edit — a one-shot ref flag suppresses the
 * push that the restore's own snapshot change triggers.
 *
 * Mount one per `ComparisonTab`; the history is per-comparison (re-seeded if
 * the `comparison.id` changes, though the tab is keyed by id so in practice the
 * component remounts instead).
 */
export function useComparisonHistory(
	comparison: Snapshot<Comparison>,
	app: Snapshot<AppState>,
	appStore: ProxyStore,
): UseComparisonHistoryResult {
	// The history instance. Re-created when the comparison identity changes,
	// seeded with that comparison's current history-relevant state. Keyed on
	// `comparison.id` only — re-seeding on every snapshot change would discard
	// the stack; the snapshot is read once here and subsequent changes flow
	// through the effect below.
	const history = useMemo(
		() => new ComparisonHistory(toHistoryState(comparison)),
		[comparison.id],
	);

	// `canUndo`/`canRedo` are state so the buttons re-render when history moves —
	// the `ComparisonHistory` instance itself is mutable and not React-observed.
	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);

	const syncFlags = useCallback(() => {
		setCanUndo(history.canUndo);
		setCanRedo(history.canRedo);
	}, [history]);

	// Set for the single snapshot change a restore (undo/redo) causes, so that
	// change is not mistaken for a fresh user edit and re-pushed.
	const suppressNextPushRef = useRef(false);

	// The last history-relevant state the effect processed — diffed against the
	// incoming snapshot to classify the edit kind for coalescing.
	const lastStateRef = useRef(toHistoryState(comparison));

	// Observe the comparison snapshot. A changed `comparison` reference with
	// history-relevant changes is a committed edit — push it (unless it is the
	// echo of a restore). `comparison.positionSec` is excluded by `toHistoryState`,
	// so playback advancing the playhead never enters the history.
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

	/**
	 * Write a restored history state back into the live comparison proxy. Mutates
	 * every history-relevant field; `positionSec` is deliberately left untouched
	 * so an undo/redo does not jump the transport playhead. `sources` is cloned
	 * out of the immutable snapshot into a plain mutable array for the proxy.
	 */
	const restore = useCallback(
		(state: ReturnType<typeof toHistoryState>) => {
			suppressNextPushRef.current = true;

			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.sources = state.sources.map((source) => ({
					id: source.id,
					name: source.name,
					audioFilePath: source.audioFilePath,
					timelineOffsetMs: source.timelineOffsetMs,
					layerColor: { primary: source.layerColor.primary, secondary: source.layerColor.secondary },
					visible: source.visible,
					muted: source.muted,
					soloed: source.soloed,
				}));
				target.activeView = state.activeView;
				target.channelInput = state.channelInput;
				target.selection = state.selection === null ? null : { start: state.selection.start, end: state.selection.end };
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
