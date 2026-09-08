import { describe, expect, it, vi } from "vitest";
import { placeAudioOnTimeline } from "./placeAudioOnTimeline";
import type { AudioData } from "../spectral/types";

function fixture() {
	const readSamples = vi.fn((_channel: number, offset: number, count: number) =>
		Promise.resolve(new Float32Array([1, 2, 3, 4]).slice(offset, offset + count)),
	);
	const audio: AudioData = { sampleRate: 1000, channels: 1, totalSamples: 4, durationMs: 4, readSamples };

	return { audio, readSamples };
}

describe("placeAudioOnTimeline", () => {
	it("pads both placement boundaries and only reads the intersecting samples", async () => {
		const { audio, readSamples } = fixture();
		const placed = placeAudioOnTimeline(audio, 3, 10);

		expect(Array.from(await placed.readSamples(0, 1, 8))).toEqual([0, 0, 1, 2, 3, 4, 0, 0]);
		expect(readSamples).toHaveBeenCalledExactlyOnceWith(0, 0, 4);
		expect(placed.durationMs).toBe(10);
	});

	it("preserves clip-local samples across consecutive chunk reads", async () => {
		const { audio } = fixture();
		const placed = placeAudioOnTimeline(audio, 3, 10);
		const first = await placed.readSamples(0, 2, 3);
		const second = await placed.readSamples(0, 5, 3);

		expect([...first, ...second]).toEqual([0, 1, 2, 3, 4, 0]);
	});

	it("never reads the source when the requested window contains silence", async () => {
		const { audio, readSamples } = fixture();
		const placed = placeAudioOnTimeline(audio, 3, 10);

		expect(Array.from(await placed.readSamples(0, 0, 3))).toEqual([0, 0, 0]);
		expect(Array.from(await placed.readSamples(0, 7, 3))).toEqual([0, 0, 0]);
		expect(readSamples).not.toHaveBeenCalled();
	});

	it("clamps the read to the comparison extent and rounds placement to a sample", async () => {
		const { audio } = fixture();
		const placed = placeAudioOnTimeline(audio, 2.6, 8);

		expect(Array.from(await placed.readSamples(0, 6, 10))).toEqual([4, 0]);
		expect(await placed.readSamples(0, 8, 10)).toHaveLength(0);
	});

	it("propagates source failures rather than replacing them with silence", async () => {
		const { audio } = fixture();
		const placed = placeAudioOnTimeline(
			{ ...audio, readSamples: () => Promise.reject(new Error("missing source")) },
			0,
			4,
		);

		await expect(placed.readSamples(0, 0, 4)).rejects.toThrow("missing source");
	});
});
