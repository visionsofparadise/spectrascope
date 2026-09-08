import { describe, expect, it } from "vitest";
import type { TimeWindow } from "./useTimeViewport";
import { computeWindowTransform, panWindow, reconcileToExtent, zoomWindow } from "./useTimeViewport";

const EXTENT: TimeWindow = { startMs: 0, endMs: 1000 };
const MIN_WINDOW_MS = 10;

describe("reconcileToExtent", () => {
	it("follows a growing whole extent", () => {
		expect(reconcileToExtent(EXTENT, EXTENT, { startMs: 100, endMs: 2000 })).toEqual({ startMs: 100, endMs: 2000 });
	});

	it("keeps a zoomed window stable while the extent grows", () => {
		expect(reconcileToExtent({ startMs: 200, endMs: 400 }, EXTENT, { startMs: 0, endMs: 2000 })).toEqual({
			startMs: 200,
			endMs: 400,
		});
	});

	it("clamps a zoomed window when a clip moves inside it", () => {
		expect(reconcileToExtent({ startMs: 800, endMs: 1000 }, EXTENT, { startMs: 0, endMs: 900 })).toEqual({
			startMs: 700,
			endMs: 900,
		});
	});
});

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
	it.each([44100, 48000, 192000])("reaches a sample at %i Hz after an hour", (rate) => {
		const result = zoomWindow(
			{ startMs: 3600000, endMs: 3600010 },
			0.00001,
			0.5,
			{ startMs: 0, endMs: 7200000 },
			1000 / rate,
		);
		expect(result.endMs - result.startMs).toBeCloseTo(1000 / rate, 7);
		expect((result.startMs + result.endMs) / 2).toBeCloseTo(3600005, 6);
	});
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

describe("computeWindowTransform", () => {
	it("is identity when the rendered and live windows match", () => {
		expect(computeWindowTransform({ startMs: 0, endMs: 1000 }, { startMs: 0, endMs: 1000 })).toBe(
			"translateX(0%) scaleX(1)",
		);
	});

	it("scales up when the live window zoomed in past the rendered window", () => {
		// rendered span 1000 over live span 500 → 2×.
		expect(computeWindowTransform({ startMs: 0, endMs: 1000 }, { startMs: 0, endMs: 500 })).toBe(
			"translateX(0%) scaleX(2)",
		);
	});

	it("scales down when the live window zoomed out past the rendered window", () => {
		// rendered span 500 over live span 1000 → 0.5×.
		expect(computeWindowTransform({ startMs: 0, endMs: 500 }, { startMs: 0, endMs: 1000 })).toBe(
			"translateX(0%) scaleX(0.5)",
		);
	});

	it("translates by the start offset as a fraction of the live span", () => {
		// rendered starts one full live-span to the right → 100%.
		expect(computeWindowTransform({ startMs: 200, endMs: 400 }, { startMs: 0, endMs: 200 })).toBe(
			"translateX(100%) scaleX(1)",
		);
	});

	it("falls back to identity for a degenerate live span", () => {
		expect(computeWindowTransform({ startMs: 200, endMs: 400 }, { startMs: 500, endMs: 500 })).toBe(
			"translateX(0%) scaleX(1)",
		);
	});
});
