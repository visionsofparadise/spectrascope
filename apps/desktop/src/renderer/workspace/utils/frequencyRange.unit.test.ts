import { describe, expect, it } from "vitest";
import {
	constrainFrequencyRange,
	panFrequencyRange,
	resizeFrequencyRange,
	zoomFrequencyRange,
	MIN_FREQUENCY_SPAN,
} from "./frequencyRange";

describe("frequency range navigation", () => {
	it("pans while preserving span at both limits", () => {
		expect(panFrequencyRange({ top: 0.2, bottom: 0.6 }, -1)).toEqual({ top: 0, bottom: 0.4 });
		const bottom = panFrequencyRange({ top: 0.2, bottom: 0.6 }, 1);
		expect(bottom.top).toBeCloseTo(0.6);
		expect(bottom.bottom).toBe(1);
	});
	it("keeps the zoom anchor stationary inside its range", () => {
		const next = zoomFrequencyRange({ top: 0.2, bottom: 0.8 }, 0.5, 0.35);
		expect(next.top + 0.25 * (next.bottom - next.top)).toBeCloseTo(0.35);
		expect(next.bottom - next.top).toBeCloseTo(0.3);
	});
	it("limits magnification and keeps handles apart", () => {
		const zoom = zoomFrequencyRange({ top: 0, bottom: 1 }, 0.00001, 0.5);
		expect(zoom.bottom - zoom.top).toBeCloseTo(MIN_FREQUENCY_SPAN);
		expect(resizeFrequencyRange({ top: 0.2, bottom: 0.4 }, "top", 0.8).top).toBeCloseTo(0.4 - MIN_FREQUENCY_SPAN);
		expect(resizeFrequencyRange({ top: 0.2, bottom: 0.4 }, "bottom", 0).bottom).toBeCloseTo(0.2 + MIN_FREQUENCY_SPAN);
	});
	it("recovers invalid persisted or nonfinite ranges", () => {
		expect(constrainFrequencyRange({ top: NaN, bottom: 1 })).toEqual({ top: 0, bottom: 1 });
		expect(constrainFrequencyRange({ top: -2, bottom: 2 })).toEqual({ top: 0, bottom: 1 });
	});
});
