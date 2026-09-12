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
	it("shares the raw reader when placement leaves integer sample coordinates unchanged", () => {
		const { audio, readSamples } = fixture();

		expect(placeAudioOnTimeline(audio, 0, 4)).toBe(audio);
		expect(placeAudioOnTimeline(audio, 0.4, 4.4)).toBe(audio);
		expect(placeAudioOnTimeline(audio, -10, 4)).toBe(audio);
		expect(readSamples).not.toHaveBeenCalled();
	});

	it("shares wrappers only for the same source and rounded placement bounds", () => {
		const { audio, readSamples } = fixture();
		const placed = placeAudioOnTimeline(audio, 3, 10);

		expect(placeAudioOnTimeline(audio, 3.2, 10.2)).toBe(placed);
		expect(placeAudioOnTimeline(audio, 4, 10).readSamples).not.toBe(placed.readSamples);
		expect(placeAudioOnTimeline(audio, 3, 11).readSamples).not.toBe(placed.readSamples);
		expect(placeAudioOnTimeline({ ...audio }, 3, 10).readSamples).not.toBe(placed.readSamples);
		expect(placeAudioOnTimeline(audio, 0, 10).readSamples).not.toBe(audio.readSamples);
		expect(readSamples).not.toHaveBeenCalled();
	});

	it("keeps eight recently used wrappers while evicted active readers remain valid", async () => {
		const { audio } = fixture();
		const first = placeAudioOnTimeline(audio, 1, 20);
		const second = placeAudioOnTimeline(audio, 2, 20);
		for (let offset = 3; offset <= 8; offset++) placeAudioOnTimeline(audio, offset, 20);
		expect(placeAudioOnTimeline(audio, 1, 20)).toBe(first);
		placeAudioOnTimeline(audio, 9, 20);
		expect(placeAudioOnTimeline(audio, 1, 20)).toBe(first);
		expect(placeAudioOnTimeline(audio, 2, 20)).not.toBe(second);
		expect([...(await second.readSamples(0, 1, 6))]).toEqual([0, 1, 2, 3, 4, 0]);
	});

	it("pads both placement boundaries and only reads the intersecting samples", async () => {
		const { audio, readSamples } = fixture();
		const placed = placeAudioOnTimeline(audio, 3, 10);

		expect(Array.from(await placed.readSamples(0, 1, 8))).toEqual([0, 0, 1, 2, 3, 4, 0, 0]);
		expect(readSamples).toHaveBeenCalledExactlyOnceWith(0, 0, 4, undefined);
		expect(placed.durationMs).toBe(10);
	});
	it("forwards the same signal with the offset-adjusted sample range", async () => {
		const { audio, readSamples } = fixture();
		const controller = new AbortController();
		const placed = placeAudioOnTimeline(audio, 3, 10);
		expect([...(await placed.readSamples(0, 1, 8, controller.signal))]).toEqual([0, 0, 1, 2, 3, 4, 0, 0]);
		expect(readSamples).toHaveBeenCalledExactlyOnceWith(0, 0, 4, controller.signal);
	});
	it("rejects canceled silence reads before touching the source", async () => {
		const { audio, readSamples } = fixture();
		const controller = new AbortController();
		controller.abort();
		await expect(placeAudioOnTimeline(audio, 3, 10).readSamples(0, 0, 3, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(readSamples).not.toHaveBeenCalled();
	});
	it("discards a source response that settles after cancellation", async () => {
		const { audio } = fixture();
		const controller = new AbortController();
		let resolveRead: ((value: Float32Array) => void) | undefined;
		const placed = placeAudioOnTimeline(
			{
				...audio,
				readSamples: () =>
					new Promise<Float32Array>((resolve) => {
						resolveRead = resolve;
					}),
			},
			3,
			10,
		);
		const pending = placed.readSamples(0, 1, 8, controller.signal);
		controller.abort();
		resolveRead?.(new Float32Array([1, 2, 3, 4]));
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
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
