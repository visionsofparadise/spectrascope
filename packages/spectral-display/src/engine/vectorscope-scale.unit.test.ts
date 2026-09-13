import { describe, expect, it } from "vitest";
import { VECTORSCOPE_SCALES, vectorscopeAmplitudeOf, vectorscopeWarpOf } from "./vectorscope-scale";

describe("vectorscopeWarpOf", () => {
	it("keeps linear radii", () => {
		expect(vectorscopeWarpOf(0.3, "linear")).toBe(0.3);
	});

	it("takes the square root", () => {
		expect(vectorscopeWarpOf(0.25, "sqrt")).toBe(0.5);
	});

	it("maps 60 dB of amplitude onto the radius", () => {
		expect(vectorscopeWarpOf(1, "log")).toBe(1);
		expect(vectorscopeWarpOf(0.1, "log")).toBeCloseTo(2 / 3, 10);
		expect(vectorscopeWarpOf(0.001, "log")).toBeCloseTo(0, 10);
		expect(vectorscopeWarpOf(0, "log")).toBe(0);
		expect(vectorscopeWarpOf(2, "log")).toBe(1);
	});

	it.each(VECTORSCOPE_SCALES)("inverts the %s warp", (scale) => {
		for (const amplitude of [0.01, 0.2, 0.5, 1]) {
			expect(vectorscopeAmplitudeOf(vectorscopeWarpOf(amplitude, scale), scale)).toBeCloseTo(amplitude, 10);
		}
	});
});
