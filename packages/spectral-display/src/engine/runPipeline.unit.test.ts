import { describe, expect, it } from "vitest";
import { WAVEFORM_POINTS_PER_SECOND } from "./loudness";
import { computeSamplesPerPoint } from "./runPipeline";

describe("computeSamplesPerPoint", () => {
	it("pins density to 500 pts/sec when loudness is enabled", () => {
		const sampleRate = 48000;

		expect(computeSamplesPerPoint(sampleRate * 10, 800, sampleRate, true)).toBe(Math.round(sampleRate / WAVEFORM_POINTS_PER_SECOND));
	});

	it("derives ~2 points per output pixel column when loudness is off", () => {
		expect(computeSamplesPerPoint(96000, 100, 48000, false)).toBe(Math.floor(96000 / (100 * 2)));
	});

	it("floors at 1 sample per point when zoomed to sample resolution", () => {
		expect(computeSamplesPerPoint(50, 100, 48000, false)).toBe(1);
	});
});
