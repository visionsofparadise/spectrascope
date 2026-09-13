import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamAudioData } from "./streamAudioData";

let sequence = 0;
let audio: ReturnType<typeof createStreamAudioData>;
beforeEach(() => {
	audio = createStreamAudioData({
		key: `sample-${String(sequence++)}`,
		sampleRate: 1000,
		channelCount: 1,
		totalFrames: 3,
		durationMs: 3,
	});
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
		expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/raw\/interleaved$/), {
			headers: { Range: "bytes=0-11" },
			signal: expect.any(AbortSignal),
		});
	});
	it("passes cancellation through fetch and rejects an obsolete pending read", async () => {
		const controller = new AbortController();
		const fetch = vi.fn(
			(_url: string, options: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
				}),
		);
		vi.stubGlobal("fetch", fetch);
		const pending = audio.readSamples(0, 0, 3, controller.signal);
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/raw\/interleaved$/), {
			headers: { Range: "bytes=0-11" },
			signal: expect.any(AbortSignal),
		});
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});
	it("rejects an already aborted read before allocating or fetching", async () => {
		const controller = new AbortController();
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		controller.abort();
		await expect(audio.readSamples(0, 0, 3, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
		await expect(audio.readSamples(0, 10, 3, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
		expect(fetch).not.toHaveBeenCalled();
	});
	it("rejects an abort while a response body is pending", async () => {
		const controller = new AbortController();
		let resolveBody: ((value: ArrayBuffer) => void) | undefined;
		const response = {
			ok: true,
			arrayBuffer: vi.fn(
				() =>
					new Promise<ArrayBuffer>((resolve) => {
						resolveBody = resolve;
					}),
			),
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
		const pending = audio.readSamples(0, 0, 3, controller.signal);
		await Promise.resolve();
		await Promise.resolve();
		expect(response.arrayBuffer).toHaveBeenCalled();
		controller.abort();
		resolveBody?.(new Float32Array([1, 2, 3]).buffer);
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});
	it("skips empty and wholly outside reads", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		expect(await audio.readSamples(0, 0, 0)).toHaveLength(0);
		expect([...(await audio.readSamples(0, 4, 2))]).toEqual([0, 0]);
		expect(fetch).not.toHaveBeenCalled();
	});
	it("shares interleaved blocks across channels, overlapping ranges and independent readers", async () => {
		const info = { key: "shared-stereo", sampleRate: 1000, channelCount: 2, totalFrames: 3, durationMs: 3 };
		const first = createStreamAudioData(info);
		const second = createStreamAudioData(info);
		const fetch = vi.fn().mockResolvedValue(new Response(new Float32Array([1, 10, 2, 20, 3, 30]).buffer));
		vi.stubGlobal("fetch", fetch);
		const [left, right] = await Promise.all([first.readSamples(0, 0, 2), second.readSamples(1, 1, 2)]);
		expect([...left]).toEqual([1, 2]);
		expect([...right]).toEqual([20, 30]);
		left[0] = 999;
		expect([...(await first.readSamples(0, 0, 3))]).toEqual([1, 2, 3]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith("media://stream/shared-stereo/raw/interleaved", {
			headers: { Range: "bytes=0-23" },
			signal: expect.any(AbortSignal),
		});
	});
	it("anchors blocks at sample zero and handles a partial final block", async () => {
		const source = createStreamAudioData({
			key: "boundary",
			sampleRate: 1000,
			channelCount: 1,
			totalFrames: 65538,
			durationMs: 65538,
		});
		const first = new Float32Array(65536);
		first[65535] = 4;
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response(first.buffer))
			.mockResolvedValueOnce(new Response(new Float32Array([5, 6]).buffer));
		vi.stubGlobal("fetch", fetch);
		expect([...(await source.readSamples(0, 65535, 3))]).toEqual([4, 5, 6]);
		expect(fetch.mock.calls.map((call) => call[1].headers.Range)).toEqual(["bytes=0-262143", "bytes=262144-262151"]);
	});
});
