import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** A time window in milliseconds. */
export interface TimeWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** The smallest window a zoom-in can reach — 10 ms of audio. */
const MIN_WINDOW_MS = 10;

/** Idle time after the last gesture tick before the viewport commits a recompute. */
const COMMIT_DEBOUNCE_MS = 150;

/** Wheel deltaY → zoom factor sensitivity (ctrl/meta + wheel). */
const ZOOM_SENSITIVITY = 0.002;

/**
 * Place a window inside an extent while preserving its span: a window that
 * overhangs an edge is shifted back in, and a window wider than the extent is
 * shrunk to the full extent. An empty extent yields the extent itself.
 */
export function clampWindowToExtent(window: TimeWindow, extent: TimeWindow): TimeWindow {
  const extentSpan = extent.endMs - extent.startMs;

  if (extentSpan <= 0) {
    return { startMs: extent.startMs, endMs: extent.startMs };
  }

  const span = Math.min(window.endMs - window.startMs, extentSpan);
  let start = window.startMs;
  let end = start + span;

  if (start < extent.startMs) {
    start = extent.startMs;
    end = start + span;
  }

  if (end > extent.endMs) {
    end = extent.endMs;
    start = end - span;
  }

  return { startMs: start, endMs: end };
}

/**
 * Shift a window along the time axis by `deltaFrac` of its own span, clamped to
 * the extent (panning past an edge stops there with the span preserved).
 */
export function panWindow(
  window: TimeWindow,
  deltaFrac: number,
  extent: TimeWindow,
): TimeWindow {
  const span = window.endMs - window.startMs;
  const shift = deltaFrac * span;

  return clampWindowToExtent(
    { startMs: window.startMs + shift, endMs: window.endMs + shift },
    extent,
  );
}

/**
 * Scale a window's span by `factor` about the cursor — the time under
 * `cursorFrac` (a `[0, 1]` position within the window) stays at `cursorFrac`.
 * The new span is floored at `minWindowMs` and capped at the extent span, then
 * the result is clamped into the extent.
 */
export function zoomWindow(
  window: TimeWindow,
  factor: number,
  cursorFrac: number,
  extent: TimeWindow,
  minWindowMs: number,
): TimeWindow {
  const span = window.endMs - window.startMs;
  const extentSpan = extent.endMs - extent.startMs;
  const cursorTime = window.startMs + cursorFrac * span;
  const maxSpan = extentSpan > 0 ? extentSpan : span;
  const newSpan = Math.min(Math.max(span * factor, minWindowMs), maxSpan);
  const start = cursorTime - cursorFrac * newSpan;

  return clampWindowToExtent({ startMs: start, endMs: start + newSpan }, extent);
}

/**
 * Reconcile an existing window with a changed extent: a window that covered the
 * whole previous extent (or is degenerate) follows to the full new extent;
 * otherwise it is clamped into the new extent.
 */
function reconcileToExtent(
  current: TimeWindow,
  previousExtent: TimeWindow,
  nextExtent: TimeWindow,
): TimeWindow {
  const wasFull =
    current.startMs <= previousExtent.startMs && current.endMs >= previousExtent.endMs;

  if (wasFull || current.endMs <= current.startMs) {
    return { startMs: nextExtent.startMs, endMs: nextExtent.endMs };
  }

  return clampWindowToExtent(current, nextExtent);
}

/**
 * CSS `translateX`/`scaleX` string mapping a `rendered` window onto the `live`
 * one for a canvas-wrapping div with `transform-origin: left`: the rendered
 * window's pixels are scaled and shifted so the time under each live-window
 * position lands where it belongs. Identity when the windows match; identity
 * fallback when the live span is degenerate.
 */
export function computeWindowTransform(rendered: TimeWindow, live: TimeWindow): string {
  const liveSpan = live.endMs - live.startMs;

  if (liveSpan <= 0) return "translateX(0%) scaleX(1)";

  const renderedSpan = rendered.endMs - rendered.startMs;
  const scaleX = renderedSpan / liveSpan;
  const translateFrac = (rendered.startMs - live.startMs) / liveSpan;

  return `translateX(${translateFrac * 100}%) scaleX(${scaleX})`;
}

export interface TimeViewport {
  /** Live window start — updates immediately on every gesture tick. */
  readonly startMs: number;
  /** Live window end — updates immediately on every gesture tick. */
  readonly endMs: number;
  /** Committed window start — follows the live window after a 150 ms idle. */
  readonly committedStartMs: number;
  /** Committed window end — follows the live window after a 150 ms idle. */
  readonly committedEndMs: number;
  /**
   * CSS `translateX`/`scaleX` mapping the committed window onto the live one,
   * for a canvas-wrapping div (`transform-origin: left`). Identity when settled.
   */
  readonly transform: string;
  /** Attach `ref` to the gesture surface (a non-passive wheel listener binds here). */
  readonly wheelHandlers: { readonly ref: React.RefObject<HTMLDivElement | null> };
  /** Set the window directly (minimap click/drag); live updates now, commit debounces. */
  readonly setViewport: (window: TimeWindow) => void;
}

/**
 * Transient per-view time viewport with scroll-pan / ctrl-scroll-zoom. Live
 * `{ startMs, endMs }` track the gesture; `committed*` follow after a 150 ms
 * idle and are what feed `SpectralQuery`. `transform` shows the live window by
 * CSS-transforming the committed-rendered canvas during the gesture. Neither
 * persisted nor pushed to undo history.
 */
export function useTimeViewport(extentStartMs: number, extentEndMs: number): TimeViewport {
  const [live, setLive] = useState<TimeWindow>({ startMs: extentStartMs, endMs: extentEndMs });
  const [committed, setCommitted] = useState<TimeWindow>({
    startMs: extentStartMs,
    endMs: extentEndMs,
  });

  const wheelTargetRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef(live);
  const extentRef = useRef<TimeWindow>({ startMs: extentStartMs, endMs: extentEndMs });
  const previousExtentRef = useRef<TimeWindow>({ startMs: extentStartMs, endMs: extentEndMs });
  const commitTimerRef = useRef<number | null>(null);

  liveRef.current = live;
  extentRef.current = { startMs: extentStartMs, endMs: extentEndMs };

  const scheduleCommit = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
    }

    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      setCommitted(liveRef.current);
    }, COMMIT_DEBOUNCE_MS);
  }, []);

  // Follow the extent when it changes (e.g. audio finishes loading): a full or
  // degenerate window snaps to the new extent, a zoomed one clamps into it.
  useEffect(() => {
    const previous = previousExtentRef.current;

    if (previous.startMs === extentStartMs && previous.endMs === extentEndMs) return;

    const nextExtent = { startMs: extentStartMs, endMs: extentEndMs };

    previousExtentRef.current = nextExtent;
    setLive((current) => reconcileToExtent(current, previous, nextExtent));
    setCommitted((current) => reconcileToExtent(current, previous, nextExtent));
  }, [extentStartMs, extentEndMs]);

  // Non-passive wheel listener — a React `onWheel` prop is passive and cannot
  // `preventDefault`, so the browser would page-zoom on ctrl+wheel.
  useEffect(() => {
    const element = wheelTargetRef.current;

    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const rect = element.getBoundingClientRect();

      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(event.deltaY * ZOOM_SENSITIVITY);
        const cursorFrac =
          rect.width > 0
            ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
            : 0.5;

        setLive((current) =>
          zoomWindow(current, factor, cursorFrac, extentRef.current, MIN_WINDOW_MS),
        );
      } else {
        const deltaFrac = rect.height > 0 ? event.deltaY / rect.height : 0;

        setLive((current) => panWindow(current, deltaFrac, extentRef.current));
      }

      scheduleCommit();
    };

    element.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [scheduleCommit]);

  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }
    },
    [],
  );

  const setViewport = useCallback(
    (next: TimeWindow) => {
      setLive(clampWindowToExtent(next, extentRef.current));
      scheduleCommit();
    },
    [scheduleCommit],
  );

  const transform = useMemo(() => computeWindowTransform(committed, live), [live, committed]);

  const wheelHandlers = useMemo(() => ({ ref: wheelTargetRef }), []);

  return {
    startMs: live.startMs,
    endMs: live.endMs,
    committedStartMs: committed.startMs,
    committedEndMs: committed.endMs,
    transform,
    wheelHandlers,
    setViewport,
  };
}
