import {
	computeKWeightingCoefficients,
	createBiquadState,
	type BiquadState,
	type KWeightingCoefficients,
} from "./k-weighting";
import { createTruePeakState, truePeakMaxAbs, type TruePeakState } from "./true-peak";
import type { SpectralMetadata } from "./runPipeline";
import type { ChannelInput } from "./SpectralEngine";

/** Side length of the square whole-clip vectorscope histogram grid (Side→X, Mid→Y). */
export const VECTORSCOPE_GRID_SIZE = 256;

/**
 * Channel energy floor below which a point's correlation coefficient is
 * reported as NaN (a silence gap). Compared against the per-point ΣL² / ΣR²
 * accumulators.
 */
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
	/** Per-chunk folded left/right scratch buffers — reused per chunk like monoBuffer. Zero-length when no stereo work is needed. */
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
	/** Per-point inter-channel correlation coefficient r ∈ [−1, +1], or NaN for silence. Zero-length when computeStereo is false. */
	correlationEnvelope: Float32Array;
	/** Whole-clip 2-D (Side, Mid) density histogram, VECTORSCOPE_GRID_SIZE². Zero-length when computeStereo is false. */
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

	for (let ch = 0; ch < channelCount; ch++) {
		biquadStates.push({
			stage1: createBiquadState(),
			stage2: createBiquadState(),
		});
		truePeakStates.push(createTruePeakState());
	}

	const channelWeights = new Float32Array(channelCount);

	if (weights) {
		for (let ch = 0; ch < channelCount; ch++) {
			channelWeights[ch] = weights[ch] ?? 1;
		}
	} else {
		channelWeights.fill(1);
	}

	// The L/R fold runs when stereo analysis is requested OR a non-mono spectrogram
	// input is selected (Phase 2 feeds Mid/Side from these buffers).
	const needsLrBuffers = computeStereo || channelInput !== "mono";
	const lrBufferSize = needsLrBuffers ? chunkSize : 0;
	// The derived FFT input buffer only exists for non-mono inputs; the mono path
	// feeds monoBuffer directly to the FFT.
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

/**
 * Derives the per-channel mix coefficients that fold an arbitrary channel
 * layout to an (L, R) stereo pair (ITU-R BS.775 Lo/Ro for 6-channel SMPTE 5.1).
 * See design-stereo-analysis.md "Channel Model".
 */
function deriveChannelFoldCoefficients(channelCount: number): {
	lCoef: Float32Array;
	rCoef: Float32Array;
} {
	const lCoef = new Float32Array(channelCount);
	const rCoef = new Float32Array(channelCount);

	if (channelCount === 1) {
		// Mono: L = R = the single channel.
		lCoef[0] = 1;
		rCoef[0] = 1;
	} else if (channelCount === 6) {
		// SMPTE 5.1 order L R C LFE Ls Rs → ITU-R BS.775 Lo/Ro; LFE (ch3) excluded.
		lCoef[0] = 1;
		lCoef[2] = BS775_SURROUND_COEF;
		lCoef[4] = BS775_SURROUND_COEF;
		rCoef[1] = 1;
		rCoef[2] = BS775_SURROUND_COEF;
		rCoef[5] = BS775_SURROUND_COEF;
	} else {
		// 2 channels — and any other count — take the first pair as L/R; the rest ignored.
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

	// The L/R fold runs when stereo analysis is requested OR a non-mono spectrogram
	// input is selected (Phase 2 derives Mid/Side from these buffers).
	const foldChannels = computeStereo || channelInput !== "mono";

	monoBuffer.fill(0, 0, samplesPerChannel);
	kwBuffer.fill(0, 0, samplesPerChannel);

	// Fold the raw channel buffers to an (L, R) pair. Reads the already-in-memory
	// chunk — no extra audio I/O. L/R come from the raw channelBuffers, NOT from
	// monoBuffer (which holds a running cross-channel sum, not L).
	if (foldChannels) {
		const { lCoef, rCoef } = deriveChannelFoldCoefficients(channelCount);

		lBuffer.fill(0, 0, samplesPerChannel);
		rBuffer.fill(0, 0, samplesPerChannel);

		for (let ch = 0; ch < channelCount; ch++) {
			const lc = lCoef[ch]!;
			const rc = rCoef[ch]!;

			if (lc === 0 && rc === 0) continue;

			const channelData = channelBuffers[ch]!;

			for (let si = 0; si < samplesPerChannel; si++) {
				const sample = channelData[si]!;

				lBuffer[si] = lBuffer[si]! + sample * lc;
				rBuffer[si] = rBuffer[si]! + sample * rc;
			}
		}
	}

	// Derive the spectrogram FFT input signal when a non-mono channelInput is
	// selected. mid = (l+r)/2, side = (l-r)/2. The FFT pipeline is input-agnostic,
	// so feeding it this buffer instead of monoBuffer needs no shader change.
	// (For 1- and 2-channel sources `mid` equals `monoBuffer`; it is produced
	// explicitly here so surround sources are correct too.)
	if (channelInput !== "mono") {
		const sideSign = channelInput === "side" ? -1 : 1;

		for (let si = 0; si < samplesPerChannel; si++) {
			channelInputBuffer[si] = (lBuffer[si]! + sideSign * rBuffer[si]!) * 0.5;
		}
	}

	// Vectorscope histogram is whole-clip: bin every sample's (Side, Mid) pair.
	if (computeStereo) {
		const gridSize = VECTORSCOPE_GRID_SIZE;
		const gridMax = gridSize - 1;
		const halfGrid = gridSize * 0.5;

		for (let si = 0; si < samplesPerChannel; si++) {
			const lSample = lBuffer[si]!;
			const rSample = rBuffer[si]!;
			const mid = (lSample + rSample) * 0.5;
			const side = (lSample - rSample) * 0.5;

			// Map Side→X, Mid→Y. Signal in [-1, +1] maps across the grid; clamp outliers.
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

	for (let ch = 0; ch < channelCount; ch++) {
		const channelData = channelBuffers[ch]!;
		const biquad = state.biquadStates[ch]!;
		const chWeight = channelWeights[ch]!;
		const tpState = state.truePeakStates[ch]!;

		let s1x1 = biquad.stage1.x1;
		let s1x2 = biquad.stage1.x2;
		let s1y1 = biquad.stage1.y1;
		let s1y2 = biquad.stage1.y2;
		let s2x1 = biquad.stage2.x1;
		let s2x2 = biquad.stage2.x2;
		let s2y1 = biquad.stage2.y1;
		let s2y2 = biquad.stage2.y2;

		if (ch < lastChannel) {
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

					kwBuffer[si] = kwBuffer[si]! + chWeight * kw * kw;
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

					kWeightedPointSum += kwBuffer[si]! + chWeight * kw * kw;
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
						// Pearson correlation r = ΣLR / sqrt(ΣL²·ΣR²), clamped to [−1, +1].
						// Below the silence floor (either channel near-silent) report NaN —
						// the design-system trace builder breaks the polyline on non-finite
						// samples, rendering a gap.
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
