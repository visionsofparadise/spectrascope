import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Shared inspection state broadcast across multiple synced views in a page.
 *
 * - `cursor`: playback / inspection cursor in milliseconds, or `null` when no
 *   cursor is set.
 * - `selection`: a `{ start, end }` time range in milliseconds, or `null` when
 *   nothing is selected.
 * - `timeRange`: the currently-visible time range in milliseconds. Every view
 *   that participates in sync uses this as its horizontal viewport.
 *
 * Frequency-axis sync (Hz min/max) is intentionally NOT part of this state in
 * the first pass — see plan-design-system-refresh-first-pass.md, Phase 5.
 */
export interface SyncState {
  readonly cursor: number | null;
  readonly selection: { readonly start: number; readonly end: number } | null;
  readonly timeRange: { readonly start: number; readonly end: number };
}

export interface SyncContextValue {
  readonly state: SyncState;
  readonly setCursor: (next: number | null) => void;
  readonly setSelection: (next: { start: number; end: number } | null) => void;
  readonly setTimeRange: (next: { start: number; end: number }) => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

interface SyncProviderProps {
  /**
   * Initial sync state. The caller must provide `timeRange` — the design
   * system has no way to guess audio duration. `cursor` and `selection`
   * default to `null` if omitted.
   */
  readonly initial: SyncState;
  readonly children: ReactNode;
}

/**
 * Wrapper that owns the shared inspection state for everything beneath it.
 * Consumers read and update via `useSync(viewId)`.
 *
 * Per-view detach is NOT owned by this context. A view that wants to opt out
 * of sync keeps its own local state for cursor / selection / time-range and
 * simply ignores the value returned from `useSync`. The detach toggle UI is
 * deferred — Phase 5 only plumbs the context.
 */
export function SyncProvider({ initial, children }: SyncProviderProps) {
  const [state, setState] = useState<SyncState>(initial);

  const setCursor = useCallback((next: number | null) => {
    setState((prev) => ({ ...prev, cursor: next }));
  }, []);

  const setSelection = useCallback(
    (next: { start: number; end: number } | null) => {
      setState((prev) => ({ ...prev, selection: next }));
    },
    [],
  );

  const setTimeRange = useCallback((next: { start: number; end: number }) => {
    setState((prev) => ({ ...prev, timeRange: next }));
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({ state, setCursor, setSelection, setTimeRange }),
    [state, setCursor, setSelection, setTimeRange],
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
