import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamAudioData } from "./streamAudioData";

const audio = createStreamAudioData({
	key: "sample",
	sampleRate: 1000,
	channelCount: 1,
	totalFrames: 3,
	durationMs: 3,
});
afterEach(() => vi.unstubAllGlobals());

describe("stream PCM reader", () => {
	it("reports failed and incomplete responses instead of fabricating silence", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(new Response("missing", { status: 404 }))
				.mockResolvedValueOnce(new Response(new Float32Array([1]).buffer)),
		);
		await expect(audio.readSamples(0, 0, 3)).rejects.toThrow("404");
		await expect(audio.readSamples(0, 0, 3)).rejects.toThrow("incomplete");
	});
	it("pads outside the actual extent and requests only intersecting samples", async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(new Float32Array([1, 2, 3]).buffer));
		vi.stubGlobal("fetch", fetch);
		expect([...(await audio.readSamples(0, -1, 5))]).toEqual([0, 1, 2, 3, 0]);
		expect(fetch).toHaveBeenCalledWith("media://stream/sample/raw/0", { headers: { Range: "bytes=0-11" } });
	});
	it("skips empty and wholly outside reads", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		expect(await audio.readSamples(0, 0, 0)).toHaveLength(0);
		expect([...(await audio.readSamples(0, 4, 2))]).toEqual([0, 0]);
		expect(fetch).not.toHaveBeenCalled();
	});
});
