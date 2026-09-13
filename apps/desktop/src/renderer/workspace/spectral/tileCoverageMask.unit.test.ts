import { describe, expect, it } from "vitest";
import { tileCoverageMask } from "./tileCoverageMask";
import type { ComputeResultReady } from "spectral-display";

function tile(startMs: number, endMs: number) {
	return { query: { startMs, endMs } } as ComputeResultReady;
}

describe("progressive tile coverage", () => {
	it("leaves nonoverlapping tiles intact", () => {
		expect(tileCoverageMask(tile(0, 100), [tile(100, 200), tile(-100, 0)])).toBeUndefined();
	});
	it("erases old waveform coverage replaced by a transparent new waveform", () => {
		expect(tileCoverageMask(tile(0, 100), [tile(0, 100)])).toBe("linear-gradient(transparent, transparent)");
	});
	it("preserves uncovered pieces around independently completed replacement tiles", () => {
		expect(tileCoverageMask(tile(0, 100), [tile(20, 40), tile(60, 120)])).toBe(
			"linear-gradient(to right, transparent 0%, transparent 0%, black 0%, black 20%, transparent 20%, transparent 40%, black 40%, black 60%, transparent 60%, transparent 100%)",
		);
	});
});
