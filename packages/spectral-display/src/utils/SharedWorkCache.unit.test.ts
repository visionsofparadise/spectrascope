import { describe, expect, it, vi } from "vitest";
import { SharedWorkCache } from "./SharedWorkCache";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe("shared work cache leases", () => {
	it("shares one job and completed result for the same owner and key", async () => {
		const cache = new SharedWorkCache<number>();
		const owner = {};
		const compute = vi.fn(async () => 10);
		const dispose = vi.fn();
		const [first, second] = await Promise.all([
			cache.run(owner, "a", undefined, compute, () => 4, dispose),
			cache.run(owner, "a", undefined, compute, () => 4, dispose),
		]);
		expect(first.value).toBe(10);
		expect(second.value).toBe(10);
		first.release();
		second.release();
		const hit = cache.get(owner, "a");
		expect(hit?.value).toBe(10);
		hit?.release();
		expect(compute).toHaveBeenCalledTimes(1);
		expect(dispose).not.toHaveBeenCalled();
		expect(cache.get({}, "a")).toBeUndefined();
	});
	it("isolates cancellation and aborts only the final waiter", async () => {
		const cache = new SharedWorkCache<number>();
		const owner = {};
		const deferredResult = deferred<number>();
		const compute = vi.fn((_signal: AbortSignal) => deferredResult.promise);
		const dispose = vi.fn();
		const firstController = new AbortController();
		const secondController = new AbortController();
		const first = cache.run(owner, "a", firstController.signal, compute, () => 4, dispose);
		const second = cache.run(owner, "a", secondController.signal, compute, () => 4, dispose);
		await Promise.resolve();
		firstController.abort();
		await expect(first).rejects.toMatchObject({ name: "AbortError" });
		expect(compute.mock.calls[0]?.[0].aborted).toBe(false);
		secondController.abort();
		await expect(second).rejects.toMatchObject({ name: "AbortError" });
		expect(compute.mock.calls[0]?.[0].aborted).toBe(true);
		deferredResult.resolve(1);
		await Promise.resolve();
		await Promise.resolve();
		expect(dispose).toHaveBeenCalledExactlyOnceWith(1);
		expect(cache.get(owner, "a")).toBeUndefined();
	});
	it("keeps replacement jobs when an abandoned job completes late", async () => {
		const cache = new SharedWorkCache<number>();
		const owner = {};
		const old = deferred<number>();
		const replacement = deferred<number>();
		const controller = new AbortController();
		const dispose = vi.fn();
		const abandoned = cache.run(
			owner,
			"a",
			controller.signal,
			() => old.promise,
			() => 4,
			dispose,
		);
		await Promise.resolve();
		controller.abort();
		await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
		const next = cache.run(
			owner,
			"a",
			undefined,
			() => replacement.promise,
			() => 4,
			dispose,
		);
		old.resolve(1);
		await Promise.resolve();
		await Promise.resolve();
		const duplicate = vi.fn(async () => 3);
		const joined = cache.run(owner, "a", undefined, duplicate, () => 4, dispose);
		replacement.resolve(2);
		const [first, second] = await Promise.all([next, joined]);
		expect(first.value).toBe(2);
		expect(second.value).toBe(2);
		first.release();
		second.release();
		expect(duplicate).not.toHaveBeenCalled();
		expect(dispose).toHaveBeenCalledExactlyOnceWith(1);
	});
	it("evicts by bytes and LRU while active leases preserve resources", async () => {
		const cache = new SharedWorkCache<number>(8, 10);
		const owner = {};
		const dispose = vi.fn();
		const first = await cache.run(
			owner,
			"a",
			undefined,
			async () => 1,
			() => 4,
			dispose,
		);
		const second = await cache.run(
			owner,
			"b",
			undefined,
			async () => 2,
			() => 4,
			dispose,
		);
		const hit = cache.get(owner, "a");
		hit?.release();
		const third = await cache.run(
			owner,
			"c",
			undefined,
			async () => 3,
			() => 4,
			dispose,
		);
		expect(cache.get(owner, "b")).toBeUndefined();
		expect(dispose).not.toHaveBeenCalled();
		second.release();
		second.release();
		expect(dispose).toHaveBeenCalledExactlyOnceWith(2);
		first.release();
		third.release();
	});
	it("bounds entries across owners and protects leases before promise continuations", async () => {
		const cache = new SharedWorkCache<number>(1024, 1);
		const dispose = vi.fn();
		const first = cache.run(
			{},
			"a",
			undefined,
			async () => 1,
			() => 4,
			dispose,
		);
		const second = cache.run(
			{},
			"a",
			undefined,
			async () => 2,
			() => 4,
			dispose,
		);
		const [one, two] = await Promise.all([first, second]);
		expect(one.value).toBe(1);
		expect(two.value).toBe(2);
		expect(dispose).not.toHaveBeenCalled();
		one.release();
		expect(dispose).toHaveBeenCalledExactlyOnceWith(1);
		two.release();
	});
	it("disposes oversized uncached results only after all leases release", async () => {
		const cache = new SharedWorkCache<number>(1, 1);
		const owner = {};
		const dispose = vi.fn();
		const compute = vi.fn(async () => 10);
		const [first, second] = await Promise.all([
			cache.run(owner, "a", undefined, compute, () => 4, dispose),
			cache.run(owner, "a", undefined, compute, () => 4, dispose),
		]);
		expect(cache.get(owner, "a")).toBeUndefined();
		first.release();
		expect(dispose).not.toHaveBeenCalled();
		second.release();
		second.release();
		expect(dispose).toHaveBeenCalledExactlyOnceWith(10);
	});
	it("retries errors and disposes results when size evaluation fails", async () => {
		const cache = new SharedWorkCache<number>();
		const owner = {};
		const dispose = vi.fn();
		await expect(
			cache.run(
				owner,
				"a",
				undefined,
				async () => {
					throw new Error("failed");
				},
				() => 4,
				dispose,
			),
		).rejects.toThrow("failed");
		await expect(
			cache.run(
				owner,
				"a",
				undefined,
				async () => 1,
				() => {
					throw new Error("size failed");
				},
				dispose,
			),
		).rejects.toThrow("size failed");
		expect(dispose).toHaveBeenCalledExactlyOnceWith(1);
		const lease = await cache.run(
			owner,
			"a",
			undefined,
			async () => 2,
			() => 4,
			dispose,
		);
		expect(lease.value).toBe(2);
		lease.release();
	});
	it("rejects already-aborted requests before starting work or acquiring a hit", async () => {
		const cache = new SharedWorkCache<number>(1, 1);
		const controller = new AbortController();
		controller.abort();
		const compute = vi.fn(async () => 1);
		await expect(cache.run({}, "a", controller.signal, compute, () => 4, vi.fn())).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(compute).not.toHaveBeenCalled();
	});
});
