import { describe, expect, it } from "vitest";
import type { TimelineClip } from "./timelineExtent";
import { computeTimelineExtent } from "./timelineExtent";

const CLIPS: ReadonlyArray<TimelineClip> = [
  { id: "a", offsetMs: 2000, durationMs: 3000 },
  { id: "b", offsetMs: 500, durationMs: 1000 },
];

describe("computeTimelineExtent", () => {
  it("hugs earliest start and latest end across clips", () => {
    // b starts earliest (500); a ends latest (2000 + 3000).
    expect(computeTimelineExtent(CLIPS, null)).toEqual({ startMs: 500, endMs: 5000 });
  });

  it("collapses to 0/0 when there are no clips", () => {
    expect(computeTimelineExtent([], null)).toEqual({ startMs: 0, endMs: 0 });
  });

  it("floors a negative stored offset at 0", () => {
    const result = computeTimelineExtent([{ id: "a", offsetMs: -400, durationMs: 1000 }], null);

    expect(result).toEqual({ startMs: 0, endMs: 1000 });
  });

  it("grows the end live when the latest clip is dragged right", () => {
    const result = computeTimelineExtent(CLIPS, { id: "a", offsetMs: 6000 });

    // a now ends at 6000 + 3000; b still the earliest start.
    expect(result).toEqual({ startMs: 500, endMs: 9000 });
  });

  it("shrinks the start when the earliest clip is dragged right", () => {
    const result = computeTimelineExtent(CLIPS, { id: "b", offsetMs: 3000 });

    // b moved to 3000; a is now the earliest start (2000) and still latest end.
    expect(result).toEqual({ startMs: 2000, endMs: 5000 });
  });
});
