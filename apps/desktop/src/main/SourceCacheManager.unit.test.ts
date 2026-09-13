import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { computeCacheKey, shouldPassThrough, touchLru, SourceCacheManager } from "./SourceCacheManager";
import { probeAudioFile, type AudioProbe } from "./audio/probe";
import { buildWavHeader } from "./audio/wavHeader";
import type { WavHeader } from "./audio/wavReader";

vi.mock("./audio/probe", () => ({ probeAudioFile: vi.fn() }));

describe("SourceCacheManager window reset", () => {
	it("keeps a new same-path pin when an older lease releases after reset", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-source-lease-"));
		const pcmPath = path.join(directory, "source.wav");
		await fs.writeFile(pcmPath, Buffer.concat([buildWavHeader(24000, 1, 2), Buffer.alloc(8)]));
		const manager = new SourceCacheManager(directory);
		const stats = await fs.stat(pcmPath);
		const hash = computeCacheKey(pcmPath, stats.size, stats.mtimeMs, 48000);
		const convertedPath = path.join(directory, "source-cache", `${hash}.wav`);
		await fs.writeFile(convertedPath, Buffer.concat([buildWavHeader(48000, 1, 4), Buffer.alloc(16)]));
		vi.mocked(probeAudioFile).mockResolvedValue({
			sampleRate: 24000,
			channelCount: 1,
			durationMs: 2 / 24,
			container: "WAVE",
			codec: "PCM",
		});
		const release = vi.spyOn(manager, "releasePreparedSource");
		try {
			const oldLease = await manager.prepareLease(pcmPath, 48000);
			manager.reset();
			const currentLease = await manager.prepareLease(pcmPath, 48000);
			expect(currentLease.prepared.pcmPath).toBe(oldLease.prepared.pcmPath);
			oldLease.release();
			oldLease.release();
			expect(release).not.toHaveBeenCalled();
			currentLease.release();
			currentLease.release();
			expect(release).toHaveBeenCalledExactlyOnceWith(convertedPath);
		} finally {
			manager.dispose();
			await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
		}
	});

	it("rejects a lease when reset occurs between preparation and lease acquisition", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-source-lease-reset-"));
		const manager = new SourceCacheManager(directory);
		vi.spyOn(manager, "prepare").mockImplementation(() => {
			manager.reset();
			return Promise.resolve({
				pcmPath: "prepared.wav",
				sampleRate: 48000,
				channelCount: 1,
				sampleCount: 4,
				nativeSampleRate: 24000,
				durationMs: 4 / 48,
			});
		});
		try {
			await expect(manager.prepareLease("source.wav", 48000)).rejects.toThrow("reset");
		} finally {
			manager.dispose();
			await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
		}
	});

	it("rejects old preparation completion and permits preparation after window recreation", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-source-reset-"));
		const pcmPath = path.join(directory, "source.wav");
		await fs.writeFile(pcmPath, Buffer.concat([buildWavHeader(48000, 1, 2), Buffer.alloc(8)]));
		const manager = new SourceCacheManager(directory);
		const probe: AudioProbe = {
			sampleRate: 48000,
			channelCount: 1,
			durationMs: 2 / 48,
			container: "WAVE",
			codec: "PCM",
		};
		let complete: (value: AudioProbe) => void = () => undefined;
		vi.mocked(probeAudioFile)
			.mockReturnValueOnce(
				new Promise((resolve) => {
					complete = resolve;
				}),
			)
			.mockResolvedValue(probe);
		try {
			const pending = manager.prepare(pcmPath, 48000);
			const rejected = expect(pending).rejects.toThrow("reset");
			manager.reset();
			complete(probe);
			await rejected;
			expect((await manager.prepare(pcmPath, 48000)).pcmPath).toBe(pcmPath);
		} finally {
			manager.dispose();
			await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
		}
	});
});

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
	it("retains pinned files while limiting idle files", () => {
		const cache = new Map<string, string>();
		const evicted: Array<string> = [];
		const retained = new Set(["/active.wav"]);
		const evict = (filePath: string): void => {
			evicted.push(filePath);
		};
		const pinned = (filePath: string): boolean => retained.has(filePath);
		touchLru(cache, "active", "/active.wav", 1, evict, pinned);
		touchLru(cache, "first", "/first.wav", 1, evict, pinned);
		touchLru(cache, "second", "/second.wav", 1, evict, pinned);
		expect(evicted).toEqual(["/first.wav"]);
		expect(cache.has("active")).toBe(true);
		retained.clear();
		touchLru(cache, "second", "/second.wav", 1, evict, pinned);
		expect(evicted).toEqual(["/first.wav", "/active.wav"]);
	});
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
