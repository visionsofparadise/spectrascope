import { describe, expect, it, vi } from "vitest";
import { computeCacheKey, shouldPassThrough, touchLru } from "./SourceCacheManager";
import type { WavHeader } from "./audio/wavReader";

const header = (sampleRate: number): WavHeader => ({
	format: "float",
	sampleRate,
	channelCount: 2,
	bitsPerSample: 32,
	bytesPerSample: 4,
	dataOffset: 44,
	dataByteLength: 800,
	frameCount: 100,
});

describe("computeCacheKey", () => {
	it("is stable for identical inputs and varies with each component", () => {
		const base = computeCacheKey("/a.wav", 1000, 12345, 48000);

		expect(computeCacheKey("/a.wav", 1000, 12345, 48000)).toBe(base);
		expect(computeCacheKey("/b.wav", 1000, 12345, 48000)).not.toBe(base);
		expect(computeCacheKey("/a.wav", 1001, 12345, 48000)).not.toBe(base);
		expect(computeCacheKey("/a.wav", 1000, 12346, 48000)).not.toBe(base);
		expect(computeCacheKey("/a.wav", 1000, 12345, 44100)).not.toBe(base);
	});
});

describe("shouldPassThrough", () => {
	it("passes through a parsed PCM WAV at the target rate", () => {
		expect(shouldPassThrough(header(48000), 48000)).toBe(true);
	});

	it("does not pass through on a rate mismatch or an unparseable header", () => {
		expect(shouldPassThrough(header(44100), 48000)).toBe(false);
		expect(shouldPassThrough(null, 48000)).toBe(false);
	});
});

describe("touchLru", () => {
	it("evicts least-recently-used entries in order and honors MRU touches", () => {
		const cache = new Map<string, string>();
		const evicted: Array<string> = [];
		const onEvict = vi.fn((filePath: string) => evicted.push(filePath));

		touchLru(cache, "h1", "/1.wav", 2, onEvict);
		touchLru(cache, "h2", "/2.wav", 2, onEvict);
		touchLru(cache, "h3", "/3.wav", 2, onEvict); // over bound: evict h1

		expect(evicted).toEqual(["/1.wav"]);
		expect([...cache.keys()]).toEqual(["h2", "h3"]);

		touchLru(cache, "h2", "/2.wav", 2, onEvict); // move h2 to MRU
		touchLru(cache, "h4", "/4.wav", 2, onEvict); // over bound: evict h3, not h2

		expect(evicted).toEqual(["/1.wav", "/3.wav"]);
		expect([...cache.keys()]).toEqual(["h2", "h4"]);
	});

	it("does not evict while within the bound", () => {
		const cache = new Map<string, string>();
		const onEvict = vi.fn();

		touchLru(cache, "h1", "/1.wav", 32, onEvict);
		touchLru(cache, "h2", "/2.wav", 32, onEvict);

		expect(onEvict).not.toHaveBeenCalled();
	});
});
