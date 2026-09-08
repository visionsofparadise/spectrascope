import { describe, expect, it, vi } from "vitest";
import { ComputeResultCache } from "./ComputeResultCache";
import { retainTexture } from "./textureOwnership";
import { resolveConfig } from "../engine/SpectralEngine";
import type { ComputeResultReady } from "../useSpectralCompute";

function result(overview = false, texture = false): ComputeResultReady {
	return {
		status: "ready",
		query: { startMs: 0, endMs: overview ? 1000 : 100, width: 4, height: 4 },
		waveformBuffer: new Float32Array(2),
		waveformPointCount: 1,
		waveformSamplesPerPoint: 1,
		loudnessData: null,
		ltas: null,
		correlationEnvelope: null,
		vectorscopeHistogram: null,
		spectrogramTexture: texture ? ({ destroy: vi.fn() } as unknown as GPUTexture) : null,
		options: {
			metadata: { sampleRate: 1000, sampleCount: 1000, channelCount: 1 },
			sampleQuery: { startSample: 0, endSample: overview ? 1000 : 100, width: 4, height: 4 },
			config: resolveConfig({ device: {} as GPUDevice, signal: new AbortController().signal }),
			readSamples: async () => new Float32Array(),
		},
	};
}

describe("bounded completed analysis cache", () => {
	it("evicts least recently used details while preferring the complete overview", () => {
		const cache = new ComputeResultCache(1024, 3);
		const overview = result(true);
		cache.set("overview", overview);
		cache.set("first", result());
		cache.set("second", result());
		cache.get("first");
		cache.set("third", result());
		expect(cache.get("second")).toBeUndefined();
		expect(cache.get("overview")).toBe(overview);
		expect(cache.get("first")).toBeDefined();
		expect(cache.get("third")).toBeDefined();
	});

	it("counts texture and unique CPU buffers against the byte limit and rejects oversized entries", () => {
		const cache = new ComputeResultCache(80, 8);
		const initial = result(false, true);
		const first = { ...initial, ltas: initial.waveformBuffer };
		cache.set("first", first);
		cache.set("second", result());
		expect(cache.get("first")).toBe(first);
		cache.set("third", result());
		expect(cache.get("second")).toBeUndefined();
		cache.set("fourth", result(false, true));
		expect(cache.get("first")).toBeUndefined();
		expect(first.spectrogramTexture!.destroy).toHaveBeenCalledOnce();
		const oversized = { ...result(), waveformBuffer: new Float32Array(21) };
		cache.set("oversized", oversized);
		expect(cache.get("oversized")).toBeUndefined();
		cache.clear();
	});

	it("retains a displayed texture through eviction and releases cache ownership once", () => {
		const cache = new ComputeResultCache(1024, 1);
		const first = result(false, true);
		const texture = first.spectrogramTexture!;
		const releaseCanvas = retainTexture(texture);
		cache.set("first", first);
		cache.set("first", first);
		cache.set("replacement", result());
		expect(texture.destroy).not.toHaveBeenCalled();
		releaseCanvas();
		expect(texture.destroy).toHaveBeenCalledOnce();
		const final = result(false, true);
		cache.set("final", final);
		cache.clear();
		cache.clear();
		expect(final.spectrogramTexture!.destroy).toHaveBeenCalledOnce();
	});
});
