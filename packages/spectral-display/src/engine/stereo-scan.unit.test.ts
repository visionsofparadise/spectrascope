import { describe, expect, it } from "vitest";
import { createScanContext, finalizeScan, scanSamples, VECTORSCOPE_GRID_SIZE } from "./sample-scan";

const POINTS_PER_SECOND = 500;
const CHUNK_SIZE = 131072;

/**
 * Runs a stereo-enabled scan over the given per-channel buffers and returns the
 * stereo scan products plus the resolved point count.
 */
function scanStereo(channelBuffers: Array<Float32Array>, sampleRate: number) {
	const channels = channelBuffers.length;
	const samplesPerPoint = Math.round(sampleRate / POINTS_PER_SECOND);
	const samplesPerChannel = channelBuffers[0]?.length ?? 0;
	const pointCount = Math.ceil(samplesPerChannel / samplesPerPoint);

	const metadata = { sampleRate, sampleCount: samplesPerChannel, channelCount: channels };
	const context = createScanContext(
		metadata,
		pointCount,
		samplesPerPoint,
		Math.min(Math.max(samplesPerChannel, 1), CHUNK_SIZE),
		true,
		true,
		true,
		"mono",
	);

	scanSamples(channelBuffers, samplesPerChannel, context);
	finalizeScan(context);

	return {
		correlationEnvelope: context.correlationEnvelope,
		vectorscopeHistogram: context.vectorscopeHistogram,
		pointCount,
		samplesPerChannel,
	};
}

/** Generates a sine buffer of the given amplitude/frequency. */
function makeSine(
	frequency: number,
	amplitude: number,
	sampleRate: number,
	samples: number,
	phaseOffset = 0,
): Float32Array {
	const buffer = new Float32Array(samples);

	for (let si = 0; si < samples; si++) {
		buffer[si] = amplitude * Math.sin((2 * Math.PI * frequency * si) / sampleRate + phaseOffset);
	}

	return buffer;
}

describe("scanSamples — stereo products", () => {
	it("reports correlation +1 for identical L/R channels", () => {
		const sampleRate = 48000;
		const samples = sampleRate; // 1 second
		const channel = makeSine(440, 0.8, sampleRate, samples);

		const result = scanStereo([channel, new Float32Array(channel)], sampleRate);

		// Every non-silent point should read exactly +1 (identical channels).
		for (let pt = 0; pt < result.pointCount - 1; pt++) {
			const corr = result.correlationEnvelope[pt]!;

			if (!Number.isNaN(corr)) {
				expect(corr).toBeCloseTo(1, 5);
			}
		}
	});

	it("reports correlation -1 for inverted L/R channels", () => {
		const sampleRate = 48000;
		const samples = sampleRate;
		const left = makeSine(440, 0.8, sampleRate, samples);
		const right = new Float32Array(samples);

		for (let si = 0; si < samples; si++) {
			right[si] = -left[si]!;
		}

		const result = scanStereo([left, right], sampleRate);

		for (let pt = 0; pt < result.pointCount - 1; pt++) {
			const corr = result.correlationEnvelope[pt]!;

			if (!Number.isNaN(corr)) {
				expect(corr).toBeCloseTo(-1, 5);
			}
		}
	});

	it("reports near-zero correlation for decorrelated channels", () => {
		const sampleRate = 48000;
		const samples = sampleRate;
		// Independent pseudo-random noise per channel is genuinely decorrelated per
		// point. (Distinct sinusoids are NOT orthogonal over a 2ms point window,
		// which only spans a fraction of a cycle.) A seeded LCG keeps it deterministic.
		const left = new Float32Array(samples);
		const right = new Float32Array(samples);
		let seedL = 1234567;
		let seedR = 7654321;

		for (let si = 0; si < samples; si++) {
			seedL = (seedL * 1103515245 + 12345) & 0x7fffffff;
			seedR = (seedR * 1103515245 + 12345) & 0x7fffffff;
			left[si] = (seedL / 0x7fffffff) * 2 - 1;
			right[si] = (seedR / 0x7fffffff) * 2 - 1;
		}

		const result = scanStereo([left, right], sampleRate);

		let maxAbsCorr = 0;

		for (let pt = 1; pt < result.pointCount - 1; pt++) {
			const corr = result.correlationEnvelope[pt]!;

			if (!Number.isNaN(corr)) {
				maxAbsCorr = Math.max(maxAbsCorr, Math.abs(corr));
			}
		}

		// 96 independent sample pairs per point — per-point |r| stays well under 0.5.
		expect(maxAbsCorr).toBeLessThan(0.5);
	});

	it("reports NaN correlation for silent points", () => {
		const sampleRate = 48000;
		const samples = sampleRate;

		const result = scanStereo([new Float32Array(samples), new Float32Array(samples)], sampleRate);

		for (let pt = 0; pt < result.pointCount; pt++) {
			expect(Number.isNaN(result.correlationEnvelope[pt]!)).toBe(true);
		}
	});

	it("treats a mono (1-channel) source as perfectly correlated with density on the Mid axis", () => {
		const sampleRate = 48000;
		const samples = sampleRate;
		const channel = makeSine(440, 0.8, sampleRate, samples);

		const result = scanStereo([channel], sampleRate);

		// Mono: L = R, so every point reads +1.
		for (let pt = 0; pt < result.pointCount - 1; pt++) {
			const corr = result.correlationEnvelope[pt]!;

			if (!Number.isNaN(corr)) {
				expect(corr).toBeCloseTo(1, 5);
			}
		}

		// Side is identically zero, so all histogram density lands on a single
		// column (the Mid axis): Side=0 → xBin = floor(1 * GRID/2) = GRID/2.
		const sideAxisColumn = VECTORSCOPE_GRID_SIZE / 2;
		let total = 0;
		let offAxis = 0;

		for (let yBin = 0; yBin < VECTORSCOPE_GRID_SIZE; yBin++) {
			for (let xBin = 0; xBin < VECTORSCOPE_GRID_SIZE; xBin++) {
				const count = result.vectorscopeHistogram[yBin * VECTORSCOPE_GRID_SIZE + xBin]!;

				total += count;

				if (xBin !== sideAxisColumn) offAxis += count;
			}
		}

		expect(offAxis).toBe(0);
		expect(total).toBe(result.samplesPerChannel);
	});

	it("accumulates one histogram increment per sample", () => {
		const sampleRate = 48000;
		const samples = sampleRate;
		const left = makeSine(440, 0.6, sampleRate, samples);
		const right = makeSine(440, 0.6, sampleRate, samples, Math.PI / 3);

		const result = scanStereo([left, right], sampleRate);

		let total = 0;

		for (let bin = 0; bin < result.vectorscopeHistogram.length; bin++) {
			total += result.vectorscopeHistogram[bin]!;
		}

		expect(total).toBe(result.samplesPerChannel);
		expect(result.vectorscopeHistogram.length).toBe(VECTORSCOPE_GRID_SIZE * VECTORSCOPE_GRID_SIZE);
	});

	it("leaves stereo outputs empty when the stereo flag is off", () => {
		const sampleRate = 48000;
		const samples = 4800;
		const samplesPerPoint = Math.round(sampleRate / POINTS_PER_SECOND);
		const pointCount = Math.ceil(samples / samplesPerPoint);
		const channel = makeSine(440, 0.8, sampleRate, samples);

		const metadata = { sampleRate, sampleCount: samples, channelCount: 2 };
		// computeStereo defaults to false; channelInput defaults to "mono".
		const context = createScanContext(metadata, pointCount, samplesPerPoint, samples);

		scanSamples([channel, new Float32Array(channel)], samples, context);

		expect(context.correlationEnvelope.length).toBe(0);
		expect(context.vectorscopeHistogram.length).toBe(0);
		expect(context.lBuffer.length).toBe(0);
		expect(context.rBuffer.length).toBe(0);
	});
});
