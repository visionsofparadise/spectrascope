import { describe, expect, it } from "vitest";
import { readWaveformAmplitude } from "./readWaveformAmplitude";
import { resolveConfig } from "../engine/SpectralEngine";
import type { ComputeResultReady } from "../useSpectralCompute";

function resultOf(samplesPerPoint = 2): ComputeResultReady {
	return {
		status: "ready",
		waveformBuffer: new Float32Array([-0.5, 0.25, -0.75, 0.5, 0.9, 0.9]),
		waveformPointCount: 3,
		waveformSamplesPerPoint: samplesPerPoint,
		spectrogramTexture: null,
		loudnessData: null,
		ltas: null,
		correlationEnvelope: null,
		vectorscopeHistogram: null,
		query: { startMs: 1000, endMs: 1005, width: 800, height: 200 },
		options: {
			metadata: { sampleRate: 1000, sampleCount: 2000, channelCount: 1 },
			sampleQuery: { startSample: 1000, endSample: 1005, width: 800, height: 200 },
			readSamples: async () => new Float32Array(),
			config: resolveConfig({ device: {} as GPUDevice, signal: new AbortController().signal }),
		},
	};
}

describe("held waveform amplitude", () => {
	it("returns selected-signal extrema and max-absolute peak in the reader time domain", () => {
		expect(readWaveformAmplitude(resultOf(), 1002.5)).toEqual({
			min: -0.75,
			max: 0.5,
			peak: 0.75,
			startMs: 1002,
			endMs: 1004,
		});
	});

	it("reports the shortened final bucket and excludes its exclusive endpoint", () => {
		expect(readWaveformAmplitude(resultOf(), 1004.5)).toMatchObject({ startMs: 1004, endMs: 1005 });
		expect(readWaveformAmplitude(resultOf(), 1005)).toBeNull();
		expect(readWaveformAmplitude(resultOf(), 999.99)).toBeNull();
	});

	it("preserves exact samples and zero at sample density", () => {
		const result = resultOf(1);
		result.waveformBuffer = new Float32Array([0, 0, -0.5, -0.5, 1.25, 1.25]);
		expect(readWaveformAmplitude(result, 1000.5)).toEqual({ min: 0, max: 0, peak: 0, startMs: 1000, endMs: 1001 });
		expect(readWaveformAmplitude(result, 1002)).toMatchObject({ min: 1.25, max: 1.25, peak: 1.25 });
	});

	it("returns unavailable for empty, invalid or nonfinite data", () => {
		expect(readWaveformAmplitude({ ...resultOf(), waveformBuffer: null }, 1001)).toBeNull();
		expect(readWaveformAmplitude(resultOf(), NaN)).toBeNull();
		expect(readWaveformAmplitude({ ...resultOf(), waveformBuffer: new Float32Array([NaN, NaN]) }, 1001)).toBeNull();
	});

	it.each([12, 158760012])("retains exact 44.1 kHz sample boundaries after offset %s", (startSample) => {
		const result = resultOf(1);
		result.options.metadata = { sampleRate: 44100, sampleCount: startSample + 3, channelCount: 1 };
		result.options.sampleQuery = { startSample, endSample: startSample + 3, width: 800, height: 200 };
		result.waveformBuffer = new Float32Array([0.25, 0.25, 0.75, 0.75, 1, 1]);
		const boundaryMs = ((startSample + 1) * 1000) / 44100;
		expect(readWaveformAmplitude(result, boundaryMs)?.peak).toBe(0.75);
		expect(readWaveformAmplitude(result, boundaryMs - 0.001)?.peak).toBe(0.25);
	});
});
