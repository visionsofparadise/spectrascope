import { describe, expect, it } from "vitest";
import { resolveFftContext } from "./fft-context";

describe("minimum FFT context", () => {
	it.each([
		[40, 42, 100, 16, 33, 49],
		[0, 1, 100, 16, 0, 16],
		[99, 100, 100, 16, 84, 100],
		[0, 3, 3, 8, -3, 5],
		[2, 3, 3, 8, -3, 5],
		[10, 30, 100, 16, 10, 30],
		[10, 10, 100, 16, 10, 10],
	])("maps [%s,%s) in %s samples at FFT %s", (start, end, total, size, expectedStart, expectedEnd) => {
		expect(resolveFftContext(start, end, total, size)).toEqual({
			startSample: expectedStart,
			endSample: expectedEnd,
		});
	});
});
