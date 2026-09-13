import { describe, expect, it, vi } from "vitest";
import { PcmBlockCache } from "./PcmBlockCache";

function deferred() {
	let resolve!: (value: Float32Array) => void;
	const promise = new Promise<Float32Array>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("shared PCM blocks", () => {
	it("isolates waiter cancellation and shares one pending load", async () => {
		const cache = new PcmBlockCache();
		const result = deferred();
		const loader = vi.fn((_signal: AbortSignal) => result.promise);
		const controller = new AbortController();
		const first = cache.read("a", loader, controller.signal);
		const second = cache.read("a", loader);
		await Promise.resolve();
		controller.abort();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		expect(loader.mock.calls[0]?.[0].aborted).toBe(false);
		result.resolve(new Float32Array([5]));
		expect([...(await second)]).toEqual([5]);
		await cache.read("a", loader);
		expect(loader).toHaveBeenCalledTimes(1);
	});
	it("cancels abandoned loads and never publishes their results", async () => {
		const cache = new PcmBlockCache();
		const abandoned = deferred();
		const loader = vi.fn((_signal: AbortSignal) => abandoned.promise);
		const controller = new AbortController();
		const first = cache.read("a", loader, controller.signal);
		await Promise.resolve();
		controller.abort();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		expect(loader.mock.calls[0]?.[0].aborted).toBe(true);
		const replacement = vi.fn(async () => new Float32Array([2]));
		expect([...(await cache.read("a", replacement))]).toEqual([2]);
		abandoned.resolve(new Float32Array([1]));
		await Promise.resolve();
		await Promise.resolve();
		expect([...(await cache.read("a", replacement))]).toEqual([2]);
		expect(replacement).toHaveBeenCalledTimes(1);
	});
	it("bounds completed bytes with least-recently-used eviction", async () => {
		const cache = new PcmBlockCache(8, 10);
		const loader = vi.fn(async () => new Float32Array([1]));
		await cache.read("a", loader);
		await cache.read("b", loader);
		await cache.read("a", loader);
		await cache.read("c", loader);
		await cache.read("a", loader);
		expect(loader).toHaveBeenCalledTimes(3);
		await cache.read("b", loader);
		expect(loader).toHaveBeenCalledTimes(4);
	});
	it("bounds entry count and skips blocks exceeding the byte budget", async () => {
		const cache = new PcmBlockCache(8, 1);
		const loader = vi.fn(async () => new Float32Array([1]));
		await cache.read("a", loader);
		await cache.read("b", loader);
		await cache.read("a", loader);
		expect(loader).toHaveBeenCalledTimes(3);
		const large = vi.fn(async () => new Float32Array(3));
		await cache.read("large", large);
		await cache.read("large", large);
		expect(large).toHaveBeenCalledTimes(2);
	});
	it("bounds active loads and removes cancelled queued requests", async () => {
		const cache = new PcmBlockCache(1024, 8, 1);
		const result = deferred();
		const first = cache.read("a", () => result.promise);
		const controller = new AbortController();
		const cancelledLoader = vi.fn(async () => new Float32Array([2]));
		const cancelled = cache.read("b", cancelledLoader, controller.signal);
		const nextLoader = vi.fn(async () => new Float32Array([3]));
		const next = cache.read("c", nextLoader);
		await Promise.resolve();
		expect(nextLoader).not.toHaveBeenCalled();
		controller.abort();
		await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
		result.resolve(new Float32Array([1]));
		await first;
		expect([...(await next)]).toEqual([3]);
		expect(cancelledLoader).not.toHaveBeenCalled();
	});
	it("retries failed blocks", async () => {
		const cache = new PcmBlockCache();
		const loader = vi
			.fn()
			.mockRejectedValueOnce(new Error("failed"))
			.mockResolvedValue(new Float32Array([1]));
		await expect(cache.read("a", loader)).rejects.toThrow("failed");
		expect([...(await cache.read("a", loader))]).toEqual([1]);
		expect(loader).toHaveBeenCalledTimes(2);
	});
});
