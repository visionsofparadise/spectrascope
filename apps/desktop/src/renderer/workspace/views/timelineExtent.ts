/** One clip on the shared timeline — its stored placement and length in ms. */
export interface TimelineClip {
  readonly id: string;
  readonly offsetMs: number;
  readonly durationMs: number;
}

/** A live drag replacing one clip's stored offset while a gesture is in flight. */
export interface TimelineDrag {
  readonly id: string;
  readonly offsetMs: number;
}

/** A time window in milliseconds. */
export interface TimelineExtent {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * The timeline extent — earliest effective clip start → latest effective clip
 * end. Offsets are floored at `0` (absolute zero is the timeline floor). A
 * `drag` override substitutes one clip's stored offset with its live drag
 * offset, so the extent follows the drag (dragging the latest clip right grows
 * `endMs`; dragging the earliest clip right shrinks `startMs`). Empty input
 * collapses to `0/0`.
 */
export function computeTimelineExtent(
  clips: ReadonlyArray<TimelineClip>,
  drag: TimelineDrag | null,
): TimelineExtent {
  if (clips.length === 0) return { startMs: 0, endMs: 0 };

  let startMs = Number.POSITIVE_INFINITY;
  let endMs = 0;

  for (const clip of clips) {
    const rawOffset =
      drag?.id === clip.id ? drag.offsetMs : clip.offsetMs;
    const offsetMs = Math.max(0, rawOffset);

    if (offsetMs < startMs) startMs = offsetMs;
    if (offsetMs + clip.durationMs > endMs) endMs = offsetMs + clip.durationMs;
  }

  return { startMs: startMs === Number.POSITIVE_INFINITY ? 0 : startMs, endMs };
}
