import { describe, expect, it } from "vitest";
import { resolveFftContext } from "./fft-context";

describe("minimum FFT context", () => {
	it("anchors contained fine views to the same source FFT block", () => {
		for (const start of [32, 35, 40, 45]) {
			expect(resolveFftContext(start, start + 2, 100, 16, true)).toEqual({ startSample: 32, endSample: 48 });
		}
	});

	it("keeps source-zero anchors at short-source and partial-tail boundaries", () => {
		expect(resolveFftContext(1, 2, 3, 16, true)).toEqual({ startSample: 0, endSample: 16 });
		expect(resolveFftContext(98, 100, 100, 16, true)).toEqual({ startSample: 96, endSample: 112 });
	});

	it("retains full coverage when a fine view straddles anchored blocks", () => {
		expect(resolveFftContext(47, 49, 100, 16, true)).toEqual({ startSample: 32, endSample: 64 });
	});
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
