import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Shared inspection state broadcast across multiple synced views in a page.
 *
 * - `cursor`: playback / inspection cursor in milliseconds, or `null` when no
 *   cursor is set.
 * - `selection`: a `{ start, end }` time range in milliseconds, or `null` when
 *   nothing is selected.
 *
 * The horizontal viewport is per-view transient state (`useTimeViewport`), not
 * shared here — each view keeps its own zoom/scroll window.
 *
 * Frequency-axis sync (Hz min/max) is intentionally NOT part of this state in
 * the first pass — see plan-design-system-refresh-first-pass.md, Phase 5.
 */
export interface SyncState {
	readonly cursor: number | null;
	readonly selection: { readonly start: number; readonly end: number } | null;
}

export interface SyncContextValue {
	/**
	 * Whether cross-view sync is currently on. When `false` the shared state is
	 * still present but views are expected to ignore it and keep their own
	 * local cursor / selection. The on/off bit is owned by the
	 * host (controlled — see `SyncProvider`'s `enabled` prop), not by this
	 * context, so a view can publish nothing while sync is off.
	 */
	readonly enabled: boolean;
	readonly state: SyncState;
	readonly setCursor: (next: number | null) => void;
	readonly setSelection: (next: { start: number; end: number } | null) => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

interface SyncProviderProps {
	/**
	 * Whether cross-view sync is on. Controlled by the host (the desktop
	 * `Comparison` owns it; the demo holds it in local state) — the design
	 * system only provides the visual `SyncToggle` and threads this flag down.
	 * When `false` the provider still holds shared state, but views read from
	 * their own local state instead (see `useViewSync`).
	 */
	readonly enabled: boolean;
	/**
	 * Initial sync state — `cursor` and `selection`, both `null` until the user
	 * interacts.
	 */
	readonly initial: SyncState;
	readonly children: ReactNode;
}

/**
 * Wrapper that owns the shared inspection state for everything beneath it.
 * Consumers read and update via `useSync(viewId)`.
 *
 * The shared cursor / selection live here as React state — they
 * are view-coordination state, not persisted application state. The on/off
 * `enabled` flag is *not* owned here; it is a controlled prop, so the host
 * (the desktop comparison) keeps the single source of truth for whether sync
 * is engaged.
 *
 * Per-view detach is NOT owned by this context. A view that wants to opt out
 * of sync keeps its own local state for cursor / selection and
 * simply ignores the value returned from `useSync`. Views consume sync via the
 * `useViewSync` helper, which falls back to local state when `enabled` is
 * `false`.
 */
export function SyncProvider({ enabled, initial, children }: SyncProviderProps) {
	const [state, setState] = useState<SyncState>(initial);

	const setCursor = useCallback((next: number | null) => {
		setState((prev) => ({ ...prev, cursor: next }));
	}, []);

	const setSelection = useCallback((next: { start: number; end: number } | null) => {
		setState((prev) => ({ ...prev, selection: next }));
	}, []);

	const value = useMemo<SyncContextValue>(
		() => ({ enabled, state, setCursor, setSelection }),
		[enabled, state, setCursor, setSelection],
	);

	return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * Read the current sync state and its setters. Must be called from inside a
 * `<SyncProvider>` subtree.
 *
 * @param viewId Identifier for the calling view. Currently unused; reserved
 *   for future per-view permissioning / detach scoping. Pass any stable
 *   string ("spectrogram", "histogram", "minimap-a", …).
 */
export function useSync(viewId: string): SyncContextValue {
	// viewId is currently unused — reserved for future per-view permissioning.
	void viewId;

	const value = useContext(SyncContext);

	if (!value) {
		throw new Error("useSync must be used inside a <SyncProvider>");
	}

	return value;
}

/**
 * What a view sees for cursor / selection, regardless of whether
 * it is currently synced. A view renders from these values and writes through
 * these setters; when sync is on they are the shared `SyncProvider` state, when
 * off they are the view's own local state.
 */
export interface ViewSync {
	/** Whether the view is currently reading/writing the shared sync state. */
	readonly synced: boolean;
	readonly cursor: number | null;
	readonly selection: { readonly start: number; readonly end: number } | null;
	readonly setCursor: (next: number | null) => void;
	readonly setSelection: (next: { start: number; end: number } | null) => void;
}

/**
 * The cursor / selection a view should render and write.
 *
 * - When the host has sync **on** (`SyncProvider`'s `enabled`), this returns
 *   the shared state and its setters — every synced view reads and writes the
 *   same cursor / selection, so moving the cursor in one view
 *   moves it in all of them.
 * - When sync is **off**, this returns the view's own local state — each view
 *   is independent, exactly as before sync was wired.
 *
 * The view always calls this hook unconditionally (hooks rules); the branch is
 * on the *value* of `enabled`, not on calling the hook. The local fallback
 * state is seeded from `localInitial` — typically the view's audio-derived
 * defaults — and is kept across an on→off→on cycle so toggling sync does not
 * lose a view's own cursor.
 *
 * Must be called inside a `<SyncProvider>` subtree.
 */
export function useViewSync(viewId: string, localInitial: SyncState): ViewSync {
	const shared = useSync(viewId);
	const [local, setLocal] = useState<SyncState>(localInitial);

	const setLocalCursor = useCallback((next: number | null) => {
		setLocal((prev) => ({ ...prev, cursor: next }));
	}, []);

	const setLocalSelection = useCallback((next: { start: number; end: number } | null) => {
		setLocal((prev) => ({ ...prev, selection: next }));
	}, []);

	if (shared.enabled) {
		return {
			synced: true,
			cursor: shared.state.cursor,
			selection: shared.state.selection,
			setCursor: shared.setCursor,
			setSelection: shared.setSelection,
		};
	}

	return {
		synced: false,
		cursor: local.cursor,
		selection: local.selection,
		setCursor: setLocalCursor,
		setSelection: setLocalSelection,
	};
}
