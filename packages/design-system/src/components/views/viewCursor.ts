/**
 * Shared cursor / selection geometry for the `SourceStrip`-based views
 * (Overlay, Slider, Difference, Sum). Each of those views shows a content cell
 * spanning a time window `[startMs, endMs]`; the cross-view sync cursor and
 * selection are absolute times in ms (see `SyncState`). These helpers map
 * between an absolute time and a `0..1` fraction within the cell, and resolve
 * a click x-coordinate to an absolute time.
 */

/**
 * Fraction (`0..1`) of the content cell at which an absolute time `ms` falls.
 * Returns `null` when the time is `null` or the window is degenerate; callers
 * skip drawing the cursor line / selection edge in that case. The fraction is
 * NOT clamped — a caller checks the `[0, 1]` range so an off-window cursor is
 * simply not drawn.
 */
export function timeToFraction(
  ms: number | null,
  startMs: number,
  endMs: number,
): number | null {
  if (ms === null) return null;

  const span = endMs - startMs;

  if (span <= 0) return null;

  return (ms - startMs) / span;
}

/**
 * Absolute time (ms) for a pointer event over a content cell. Maps the
 * pointer's x within the element's rect onto the `[startMs, endMs]` window,
 * clamped to that window. Returns `null` for a degenerate rect.
 */
export function eventToTime(
  event: { readonly clientX: number; readonly currentTarget: Element },
  startMs: number,
  endMs: number,
): number | null {
  const rect = event.currentTarget.getBoundingClientRect();

  if (rect.width <= 0) return null;

  const frac = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));

  return startMs + frac * (endMs - startMs);
}
