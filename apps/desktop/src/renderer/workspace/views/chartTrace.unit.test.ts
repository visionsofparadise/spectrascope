import { describe, expect, it } from "vitest";
import { buildPolylineSegments } from "./chartTrace";

const identityY = (value: number) => value;

describe("buildPolylineSegments", () => {
	it("defaults X to the index normalized across the count", () => {
		const points = buildPolylineSegments(new Float32Array([0, 0.5, 1]), identityY);

		expect(points).toEqual(["0,0 0.5,0.5 1,1"]);
	});

	it("places samples with a custom index→X mapper (non-uniform axis)", () => {
		// LTAS-style: bands are not evenly spaced along X, so the caller supplies
		// the placement. Here index 0→0.1, 1→0.4, 2→0.9 (float32-exact Y = 0.25).
		const xs = [0.1, 0.4, 0.9];
		const points = buildPolylineSegments(
			new Float32Array([0.25, 0.25, 0.25]),
			identityY,
			(index) => xs[index] ?? 0,
		);

		expect(points).toEqual(["0.1,0.25 0.4,0.25 0.9,0.25"]);
	});

	it("breaks into separate polylines around a non-finite sample", () => {
		const points = buildPolylineSegments(
			new Float32Array([0.5, Number.NaN, 0.75]),
			identityY,
			(index) => index / 2,
		);

		expect(points).toEqual(["0,0.5", "1,0.75"]);
	});

	it("returns no segments for an empty input", () => {
		expect(buildPolylineSegments(new Float32Array(0), identityY)).toEqual([]);
	});
});
