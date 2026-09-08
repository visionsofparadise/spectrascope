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
		expect(fetch).toHaveBeenCalledWith("media://stream/sample/raw/0", {
			headers: { Range: "bytes=0-11" },
			signal: undefined,
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
		expect(fetch).toHaveBeenCalledWith("media://stream/sample/raw/0", {
			headers: { Range: "bytes=0-11" },
			signal: controller.signal,
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
});
