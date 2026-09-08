import { describe, expect, it } from "vitest";
import { majorTickIntervalMs } from "./timeTicks";

describe("majorTickIntervalMs", () => {
	it.each([10, 50, 1000, 60000, 3600000, 86400000])("keeps major ticks readable and bounded over %ims", (spanMs) => {
		const interval = majorTickIntervalMs(spanMs);
		const count = spanMs / interval;

		expect(count).toBeGreaterThanOrEqual(3);
		expect(count).toBeLessThanOrEqual(8);
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("keeps an invalid span safe: %s", (spanMs) => {
		expect(majorTickIntervalMs(spanMs)).toBe(1);
	});
});
