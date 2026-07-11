import { describe, expect, it } from "vitest";
import type { TimeWindow } from "./useTimeViewport";
import { panWindow, zoomWindow } from "./useTimeViewport";

const EXTENT: TimeWindow = { startMs: 0, endMs: 1000 };
const MIN_WINDOW_MS = 10;

describe("panWindow", () => {
  it("shifts the window by a fraction of its span", () => {
    const result = panWindow({ startMs: 100, endMs: 300 }, 0.5, EXTENT);

    // span 200, deltaFrac 0.5 → +100 ms.
    expect(result).toEqual({ startMs: 200, endMs: 400 });
  });

  it("clamps at the right edge preserving span", () => {
    const result = panWindow({ startMs: 800, endMs: 1000 }, 0.5, EXTENT);

    expect(result).toEqual({ startMs: 800, endMs: 1000 });
  });

  it("clamps at the left edge preserving span", () => {
    const result = panWindow({ startMs: 0, endMs: 200 }, -0.5, EXTENT);

    expect(result).toEqual({ startMs: 0, endMs: 200 });
  });
});

describe("zoomWindow", () => {
  it("keeps the cursor's time fixed across a zoom (interior)", () => {
    const window: TimeWindow = { startMs: 200, endMs: 400 };
    const cursorFrac = 0.25;
    const cursorTime = window.startMs + cursorFrac * (window.endMs - window.startMs);

    const zoomedIn = zoomWindow(window, 0.5, cursorFrac, EXTENT, MIN_WINDOW_MS);
    const zoomedOut = zoomWindow(window, 1.5, cursorFrac, EXTENT, MIN_WINDOW_MS);

    const timeIn = zoomedIn.startMs + cursorFrac * (zoomedIn.endMs - zoomedIn.startMs);
    const timeOut = zoomedOut.startMs + cursorFrac * (zoomedOut.endMs - zoomedOut.startMs);

    expect(timeIn).toBeCloseTo(cursorTime, 6);
    expect(timeOut).toBeCloseTo(cursorTime, 6);
    // Span actually scaled by the factor.
    expect(zoomedIn.endMs - zoomedIn.startMs).toBeCloseTo(100, 6);
  });

  it("floors the window at minWindowMs", () => {
    const result = zoomWindow({ startMs: 400, endMs: 600 }, 0.001, 0.5, EXTENT, MIN_WINDOW_MS);

    expect(result.endMs - result.startMs).toBeCloseTo(MIN_WINDOW_MS, 6);
    // Still centred on the cursor time (500 ms) since we are in the interior.
    expect((result.startMs + result.endMs) / 2).toBeCloseTo(500, 6);
  });

  it("caps the span at the extent and clamps into it on zoom-out", () => {
    const result = zoomWindow({ startMs: 200, endMs: 400 }, 100, 0.5, EXTENT, MIN_WINDOW_MS);

    expect(result).toEqual({ startMs: 0, endMs: 1000 });
  });
});
