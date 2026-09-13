import { describe, expect, it } from "vitest";
import { constrainFrequencyRange, MIN_FREQUENCY_SPAN } from "./frequencyRange";

describe("frequency range constraint", () => {
	it("recovers invalid persisted or nonfinite ranges", () => {
		expect(constrainFrequencyRange({ top: NaN, bottom: 1 })).toEqual({ top: 0, bottom: 1 });
		expect(constrainFrequencyRange({ top: -2, bottom: 2 })).toEqual({ top: 0, bottom: 1 });
	});
	it("keeps the persisted crop at least the minimum frequency span", () => {
		const range = constrainFrequencyRange({ top: 0.5, bottom: 0.5 });
		expect(range.bottom - range.top).toBeCloseTo(MIN_FREQUENCY_SPAN);
	});
});
