import {
	computeKWeightingCoefficients,
	createBiquadState,
	type BiquadState,
	type KWeightingCoefficients,
} from "./k-weighting";
import { createTruePeakState, truePeakMaxAbs, type TruePeakState } from "./true-peak";
import type { SpectralMetadata } from "./runPipeline";
import type { ChannelInput } from "./SpectralEngine";

export const VECTORSCOPE_GRID_SIZE = 256;

const CORRELATION_SILENCE_FLOOR = 1e-12;

interface ScanState {
	pointIndex: number;
	samplesInCurrentPoint: number;
	pointMin: number;
	pointMax: number;
	pointSumSq: number;
	pointPeak: number;
	kWeightedPointSum: number;
	pointSumL2: number;
	pointSumR2: number;
	pointSumLR: number;
	overallPeakAbs: number;
	overallSumSquares: number;
	totalSampleValues: number;
	truePeakAbs: number;
	biquadStates: Array<{ stage1: BiquadState; stage2: BiquadState }>;
	truePeakStates: Array<TruePeakState>;
}

export interface ScanContext {
	channelCount: number;
	channelWeights: Float32Array;
	samplesPerPoint: number;
	computeLoudness: boolean;
	computeTruePeak: boolean;
	computeStereo: boolean;
	channelInput: ChannelInput;
	kWeightingCoefficients: KWeightingCoefficients;
	state: ScanState;
	monoBuffer: Float32Array;
	kwBuffer: Float32Array;
	lBuffer: Float32Array;
	rBuffer: Float32Array;
	/**
	 * Per-chunk derived FFT input signal — reused per chunk like monoBuffer.
	 * Holds the Mid or Side signal when `channelInput` is non-"mono"; zero-length
	 * for `channelInput === "mono"` (the FFT consumes `monoBuffer` directly).
	 */
	channelInputBuffer: Float32Array;
	waveformBuffer: Float32Array;
	rmsEnvelope: Float32Array;
	peakEnvelope: Float32Array;
	kWeightedMeanSquare: Float32Array;
	correlationEnvelope: Float32Array;
	vectorscopeHistogram: Uint32Array;
}

export function createScanContext(
	metadata: SpectralMetadata,
	pointCount: number,
	samplesPerPoint: number,
	chunkSize: number,
	computeLoudness = true,
	computeTruePeak = true,
	computeStereo = false,
	channelInput: ChannelInput = "mono",
): ScanContext {
	const { channelCount, sampleRate, channelWeights: weights } = metadata;
	const biquadStates: Array<{ stage1: BiquadState; stage2: BiquadState }> = [];
	const truePeakStates: Array<TruePeakState> = [];

	for (let channel = 0; channel < channelCount; channel++) {
		biquadStates.push({
			stage1: createBiquadState(),
			stage2: createBiquadState(),
		});
		truePeakStates.push(createTruePeakState());
	}

	const channelWeights = new Float32Array(channelCount);

	if (weights) {
		for (let channel = 0; channel < channelCount; channel++) {
			channelWeights[channel] = weights[channel] ?? 1;
		}
	} else {
		channelWeights.fill(1);
	}

	const needsLrBuffers = computeStereo || channelInput !== "mono";
	const lrBufferSize = needsLrBuffers ? chunkSize : 0;
	const channelInputBufferSize = channelInput !== "mono" ? chunkSize : 0;

	return {
		channelCount,
		channelWeights,
		samplesPerPoint,
		computeLoudness,
		computeTruePeak,
		computeStereo,
		channelInput,
		kWeightingCoefficients: computeKWeightingCoefficients(sampleRate),
		state: {
			pointIndex: 0,
			samplesInCurrentPoint: 0,
			pointMin: Infinity,
			pointMax: -Infinity,
			pointSumSq: 0,
			pointPeak: 0,
			kWeightedPointSum: 0,
			pointSumL2: 0,
			pointSumR2: 0,
			pointSumLR: 0,
			overallPeakAbs: 0,
			overallSumSquares: 0,
			totalSampleValues: 0,
			truePeakAbs: 0,
			biquadStates,
			truePeakStates,
		},
		monoBuffer: new Float32Array(chunkSize),
		kwBuffer: new Float32Array(chunkSize),
		lBuffer: new Float32Array(lrBufferSize),
		rBuffer: new Float32Array(lrBufferSize),
		channelInputBuffer: new Float32Array(channelInputBufferSize),
		waveformBuffer: new Float32Array(pointCount * 2),
		rmsEnvelope: new Float32Array(pointCount),
		peakEnvelope: new Float32Array(pointCount),
		kWeightedMeanSquare: new Float32Array(pointCount),
		correlationEnvelope: new Float32Array(computeStereo ? pointCount : 0),
		vectorscopeHistogram: new Uint32Array(computeStereo ? VECTORSCOPE_GRID_SIZE * VECTORSCOPE_GRID_SIZE : 0),
	};
}

export function finalizeScan(context: ScanContext): { overallPeak: number; overallRms: number; truePeak: number } {
	const { state } = context;

	return {
		overallPeak: state.overallPeakAbs,
		overallRms: state.totalSampleValues > 0 ? Math.sqrt(state.overallSumSquares / state.totalSampleValues) : 0,
		truePeak: state.truePeakAbs,
	};
}

const BS775_SURROUND_COEF = Math.SQRT1_2;

function deriveChannelFoldCoefficients(channelCount: number): {
	lCoef: Float32Array;
	rCoef: Float32Array;
} {
	const lCoef = new Float32Array(channelCount);
	const rCoef = new Float32Array(channelCount);

	if (channelCount === 1) {
		lCoef[0] = 1;
		rCoef[0] = 1;
	} else if (channelCount === 6) {
		lCoef[0] = 1;
		lCoef[2] = BS775_SURROUND_COEF;
		lCoef[4] = BS775_SURROUND_COEF;
		rCoef[1] = 1;
		rCoef[2] = BS775_SURROUND_COEF;
		rCoef[5] = BS775_SURROUND_COEF;
	} else {
		lCoef[0] = 1;
		rCoef[1] = 1;
	}

	return { lCoef, rCoef };
}

export function scanSamples(
	channelBuffers: ReadonlyArray<Float32Array>,
	samplesPerChannel: number,
	context: ScanContext,
	timing?: { channelPass: number; reduction: number },
): void {
	const {
		channelCount,
		channelWeights,
		samplesPerPoint,
		computeLoudness,
		computeTruePeak,
		computeStereo,
		channelInput,
		kWeightingCoefficients,
		state,
		monoBuffer,
		kwBuffer,
		lBuffer,
		rBuffer,
		channelInputBuffer,
		waveformBuffer,
		rmsEnvelope,
		peakEnvelope,
		kWeightedMeanSquare,
		correlationEnvelope,
		vectorscopeHistogram,
	} = context;
	const invChannels = 1 / channelCount;
	const { stage1: s1Coeffs, stage2: s2Coeffs } = kWeightingCoefficients;
	const lastChannel = channelCount - 1;
	const pointCount = Math.ceil(waveformBuffer.length / 2);

	const foldChannels = computeStereo || channelInput !== "mono";

	monoBuffer.fill(0, 0, samplesPerChannel);
	kwBuffer.fill(0, 0, samplesPerChannel);

	if (foldChannels) {
		const { lCoef, rCoef } = deriveChannelFoldCoefficients(channelCount);

		lBuffer.fill(0, 0, samplesPerChannel);
		rBuffer.fill(0, 0, samplesPerChannel);

		for (let channel = 0; channel < channelCount; channel++) {
			const lc = lCoef[channel]!;
			const rc = rCoef[channel]!;

			if (lc === 0 && rc === 0) continue;

			const channelData = channelBuffers[channel]!;

			for (let si = 0; si < samplesPerChannel; si++) {
				const sample = channelData[si]!;

				lBuffer[si] = lBuffer[si]! + sample * lc;
				rBuffer[si] = rBuffer[si]! + sample * rc;
			}
		}
	}

	if (channelInput !== "mono") {
		const sideSign = channelInput === "side" ? -1 : 1;

		for (let si = 0; si < samplesPerChannel; si++) {
			channelInputBuffer[si] = (lBuffer[si]! + sideSign * rBuffer[si]!) * 0.5;
		}
	}

	if (computeStereo) {
		const gridSize = VECTORSCOPE_GRID_SIZE;
		const gridMax = gridSize - 1;
		const halfGrid = gridSize * 0.5;

		for (let si = 0; si < samplesPerChannel; si++) {
			const lSample = lBuffer[si]!;
			const rSample = rBuffer[si]!;
			const mid = (lSample + rSample) * 0.5;
			const side = (lSample - rSample) * 0.5;

			let xBin = Math.floor((side + 1) * halfGrid);
			let yBin = Math.floor((mid + 1) * halfGrid);

			if (xBin < 0) xBin = 0;
			else if (xBin > gridMax) xBin = gridMax;

			if (yBin < 0) yBin = 0;
			else if (yBin > gridMax) yBin = gridMax;

			vectorscopeHistogram[yBin * gridSize + xBin]!++;
		}
	}

	let { pointIndex, samplesInCurrentPoint } = state;
	let { pointMin, pointMax, pointSumSq, pointPeak, kWeightedPointSum } = state;
	let { pointSumL2, pointSumR2, pointSumLR } = state;
	let { overallPeakAbs, overallSumSquares, totalSampleValues, truePeakAbs } = state;

	const t0 = timing ? performance.now() : 0;

	const s1b0 = s1Coeffs.b0;
	const s1b1 = s1Coeffs.b1;
	const s1b2 = s1Coeffs.b2;
	const s1a1 = s1Coeffs.a1;
	const s1a2 = s1Coeffs.a2;
	const s2b0 = s2Coeffs.b0;
	const s2b1 = s2Coeffs.b1;
	const s2b2 = s2Coeffs.b2;
	const s2a1 = s2Coeffs.a1;
	const s2a2 = s2Coeffs.a2;

	for (let channel = 0; channel < channelCount; channel++) {
		const channelData = channelBuffers[channel]!;
		const biquad = state.biquadStates[channel]!;
		const channelWeight = channelWeights[channel]!;
		const tpState = state.truePeakStates[channel]!;

		let s1x1 = biquad.stage1.x1;
		let s1x2 = biquad.stage1.x2;
		let s1y1 = biquad.stage1.y1;
		let s1y2 = biquad.stage1.y2;
		let s2x1 = biquad.stage2.x1;
		let s2x2 = biquad.stage2.x2;
		let s2y1 = biquad.stage2.y1;
		let s2y2 = biquad.stage2.y2;

		if (channel < lastChannel) {
			for (let si = 0; si < samplesPerChannel; si++) {
				const sample = channelData[si]!;

				monoBuffer[si] = monoBuffer[si]! + sample;

				if (computeLoudness) {
					const s1out = s1b0 * sample + s1b1 * s1x1 + s1b2 * s1x2 - s1a1 * s1y1 - s1a2 * s1y2;

					s1x2 = s1x1;
					s1x1 = sample;
					s1y2 = s1y1;
					s1y1 = s1out;

					const kw = s2b0 * s1out + s2b1 * s2x1 + s2b2 * s2x2 - s2a1 * s2y1 - s2a2 * s2y2;

					s2x2 = s2x1;
					s2x1 = s1out;
					s2y2 = s2y1;
					s2y1 = kw;

					kwBuffer[si] = kwBuffer[si]! + channelWeight * kw * kw;
				}

				if (computeTruePeak) {
					const tp = truePeakMaxAbs(sample, tpState);

					if (tp > truePeakAbs) truePeakAbs = tp;
				}
			}
		} else {
			if (timing) {
				timing.channelPass += performance.now() - t0;
			}

			const t1 = timing ? performance.now() : 0;

			for (let si = 0; si < samplesPerChannel; si++) {
				const sample = channelData[si]!;
				const mono = (monoBuffer[si]! + sample) * invChannels;

				monoBuffer[si] = mono;

				if (computeLoudness) {
					const s1out = s1b0 * sample + s1b1 * s1x1 + s1b2 * s1x2 - s1a1 * s1y1 - s1a2 * s1y2;

					s1x2 = s1x1;
					s1x1 = sample;
					s1y2 = s1y1;
					s1y1 = s1out;

					const kw = s2b0 * s1out + s2b1 * s2x1 + s2b2 * s2x2 - s2a1 * s2y1 - s2a2 * s2y2;

					s2x2 = s2x1;
					s2x1 = s1out;
					s2y2 = s2y1;
					s2y1 = kw;

					kWeightedPointSum += kwBuffer[si]! + channelWeight * kw * kw;
				}

				if (computeTruePeak) {
					const tp = truePeakMaxAbs(sample, tpState);

					if (tp > truePeakAbs) truePeakAbs = tp;
				}

				const sq = mono * mono;
				const abs = mono < 0 ? -mono : mono;

				if (mono < pointMin) pointMin = mono;

				if (mono > pointMax) pointMax = mono;

				pointSumSq += sq;

				if (abs > pointPeak) pointPeak = abs;

				if (abs > overallPeakAbs) overallPeakAbs = abs;

				overallSumSquares += sq;

				if (computeStereo) {
					const lSample = lBuffer[si]!;
					const rSample = rBuffer[si]!;

					pointSumL2 += lSample * lSample;
					pointSumR2 += rSample * rSample;
					pointSumLR += lSample * rSample;
				}

				samplesInCurrentPoint++;
				totalSampleValues++;

				if (samplesInCurrentPoint >= samplesPerPoint && pointIndex < pointCount) {
					const wo = pointIndex * 2;
					const invSamples = 1 / samplesInCurrentPoint;

					waveformBuffer[wo] = pointMin;
					waveformBuffer[wo + 1] = pointMax;
					rmsEnvelope[pointIndex] = Math.sqrt(pointSumSq * invSamples);
					peakEnvelope[pointIndex] = pointPeak;
					kWeightedMeanSquare[pointIndex] = kWeightedPointSum * invSamples;

					if (computeStereo) {
						if (pointSumL2 < CORRELATION_SILENCE_FLOOR || pointSumR2 < CORRELATION_SILENCE_FLOOR) {
							correlationEnvelope[pointIndex] = NaN;
						} else {
							const corr = pointSumLR / Math.sqrt(pointSumL2 * pointSumR2);

							correlationEnvelope[pointIndex] = corr < -1 ? -1 : corr > 1 ? 1 : corr;
						}
					}

					pointMin = Infinity;
					pointMax = -Infinity;
					pointSumSq = 0;
					pointPeak = 0;
					kWeightedPointSum = 0;
					pointSumL2 = 0;
					pointSumR2 = 0;
					pointSumLR = 0;
					samplesInCurrentPoint = 0;
					pointIndex++;
				}
			}

			if (timing) timing.reduction += performance.now() - t1;
		}

		biquad.stage1.x1 = s1x1;
		biquad.stage1.x2 = s1x2;
		biquad.stage1.y1 = s1y1;
		biquad.stage1.y2 = s1y2;
		biquad.stage2.x1 = s2x1;
		biquad.stage2.x2 = s2x2;
		biquad.stage2.y1 = s2y1;
		biquad.stage2.y2 = s2y2;
	}

	state.overallPeakAbs = overallPeakAbs;
	state.overallSumSquares = overallSumSquares;
	state.totalSampleValues = totalSampleValues;
	state.truePeakAbs = truePeakAbs;
	state.pointIndex = pointIndex;
	state.samplesInCurrentPoint = samplesInCurrentPoint;
	state.pointMin = pointMin;
	state.pointMax = pointMax;
	state.pointSumSq = pointSumSq;
	state.pointPeak = pointPeak;
	state.kWeightedPointSum = kWeightedPointSum;
	state.pointSumL2 = pointSumL2;
	state.pointSumR2 = pointSumR2;
	state.pointSumLR = pointSumLR;
}
