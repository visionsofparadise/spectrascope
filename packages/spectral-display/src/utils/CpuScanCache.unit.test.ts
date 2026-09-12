import { describe, expect, it } from "vitest";
import { CpuScanCache } from "./CpuScanCache";

function request() {
	return {
		metadata: { sampleRate: 48000, sampleCount: 11, channelCount: 2 },
		readSamples: async () => new Float32Array(),
		startSample: 0,
		endSample: 11,
		channelInput: "mono" as const,
		waveformSamplesPerPoint: 2,
		measurementSamplesPerPoint: 2,
		loudness: false,
		truePeak: false,
		stereo: false,
	};
}

function data() {
	return {
		waveformBuffer: new Float32Array([-1, 2, -3, 4, -5, 6, -7, 8, -9, 10, 20, 20]),
		waveformPointCount: 6,
		waveformSamplesPerPoint: 2,
		loudnessData: null,
		correlationEnvelope: null,
		vectorscopeHistogram: null,
	};
}

describe("shared CPU scan cache", () => {
	it("merges exact aligned extrema and retains the final partial bucket", () => {
		const cache = new CpuScanCache();
		const key = request();
		cache.set(key, data());
		const hit = cache.get({ ...key, waveformSamplesPerPoint: 4, measurementSamplesPerPoint: 4 });
		expect(hit?.waveformBuffer).toEqual(new Float32Array([-3, 4, -7, 8, -9, 20]));
		expect(hit?.waveformPointCount).toBe(3);
		expect(hit?.waveformSamplesPerPoint).toBe(4);
		expect(cache.get({ ...key, waveformSamplesPerPoint: 1 })).toBeUndefined();
		expect(cache.get({ ...key, waveformSamplesPerPoint: 3 })).toBeUndefined();
	});

	it("isolates reader, integer range, metadata, channel weights and selected signal", () => {
		const cache = new CpuScanCache();
		const key = request();
		cache.set(key, data());
		for (const changed of [
			{ readSamples: request().readSamples },
			{ startSample: 1 },
			{ endSample: 10 },
			{ metadata: { ...key.metadata, sampleRate: 44100 } },
			{ metadata: { ...key.metadata, sampleCount: 12 } },
			{ metadata: { ...key.metadata, channelCount: 1 } },
			{ metadata: { ...key.metadata, channelWeights: [1, 0] } },
			{ channelInput: "side" as const },
		])
			expect(cache.get({ ...key, ...changed })).toBeUndefined();
	});

	it("requires loudness, true peak and matching stereo measurement bins", () => {
		const cache = new CpuScanCache();
		const key = request();
		cache.set(key, data());
		expect(cache.get({ ...key, loudness: true })).toBeUndefined();
		expect(cache.get({ ...key, truePeak: true })).toBeUndefined();
		expect(cache.get({ ...key, stereo: true })).toBeUndefined();
		cache.set(
			{ ...key, stereo: true },
			{
				...data(),
				correlationEnvelope: new Float32Array(6).fill(0.5),
				vectorscopeHistogram: new Uint32Array([1, 2]),
			},
		);
		expect(cache.get({ ...key, stereo: true })?.correlationEnvelope?.[0]).toBe(0.5);
		expect(cache.get({ ...key, stereo: true, measurementSamplesPerPoint: 4 })).toBeUndefined();
		expect(cache.get(key)?.correlationEnvelope).toBeNull();
	});

	it("owns independent copies of inserted and returned arrays", () => {
		const cache = new CpuScanCache();
		const key = { ...request(), stereo: true };
		const value = {
			...data(),
			correlationEnvelope: new Float32Array([0.5]),
			vectorscopeHistogram: new Uint32Array([3]),
		};
		cache.set(key, value);
		value.waveformBuffer[0] = 99;
		value.correlationEnvelope[0] = 99;
		value.vectorscopeHistogram[0] = 99;
		const first = cache.get(key)!;
		expect(first.waveformBuffer[0]).toBe(-1);
		expect(first.correlationEnvelope?.[0]).toBe(0.5);
		expect(first.vectorscopeHistogram?.[0]).toBe(3);
		first.waveformBuffer[0] = 77;
		first.correlationEnvelope![0] = 77;
		first.vectorscopeHistogram![0] = 77;
		const second = cache.get(key)!;
		expect(second.waveformBuffer[0]).toBe(-1);
		expect(second.correlationEnvelope?.[0]).toBe(0.5);
		expect(second.vectorscopeHistogram?.[0]).toBe(3);
	});

	it("requires matching loudness bins even when the waveform resolution is compatible", () => {
		const cache = new CpuScanCache();
		const key = { ...request(), loudness: true };
		cache.set(key, {
			...data(),
			loudnessData: {
				rmsEnvelope: new Float32Array([0.5]),
				peakEnvelope: new Float32Array([1]),
				momentaryLufs: new Float32Array([-6]),
				shortTermLufs: new Float32Array([-6]),
				integratedLufs: -6,
				peakDb: 0,
				rmsDb: -6,
				crestFactor: 6,
				pointCount: 1,
			},
		});
		expect(cache.get(key)?.loudnessData?.integratedLufs).toBe(-6);
		expect(cache.get({ ...key, measurementSamplesPerPoint: 4 })).toBeUndefined();
	});

	it("enforces global byte and entry limits using least recent access", () => {
		const first = request();
		const second = request();
		const third = request();
		for (const cache of [new CpuScanCache(96), new CpuScanCache(1000, 2)]) {
			cache.set(first, data());
			cache.set(second, data());
			expect(cache.get(first)).toBeDefined();
			cache.set(third, data());
			expect(cache.get(first)).toBeDefined();
			expect(cache.get(second)).toBeUndefined();
			expect(cache.get(third)).toBeDefined();
		}
	});

	it("bounds each reader and skips entries larger than its global budget", () => {
		const cache = new CpuScanCache(1000, 32, 2);
		const key = request();
		cache.set(key, data());
		cache.set({ ...key, startSample: 1 }, data());
		cache.set({ ...key, startSample: 2 }, data());
		expect(cache.get(key)).toBeUndefined();
		expect(cache.get({ ...key, startSample: 1 })).toBeDefined();
		const tiny = new CpuScanCache(47);
		tiny.set(key, data());
		expect(tiny.get(key)).toBeUndefined();
	});
});
