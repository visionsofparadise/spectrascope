import { resolveRenderDimensions } from "../utils/resolveRenderDimensions";
import { getMaxFftSize } from "./device";
import { resolveFftContext } from "./fft-context";
import { computeLoudnessData, WAVEFORM_POINTS_PER_SECOND } from "./loudness";
import { createScanContext, finalizeScan, scanSamples } from "./sample-scan";
import {
	computeHopSize,
	resolveConfig,
	type Dimensions,
	type SpectralConfig,
	type SpectralEngine,
} from "./SpectralEngine";
import { StratifiedSpectrogramSampler } from "./StratifiedSpectrogramSampler";
import type { LoudnessData } from "./loudness";
import type { RequiredProperties } from "../utils/RequiredProperties";

export interface SpectralMetadata {
	sampleRate: number;
	sampleCount: number;
	channelCount: number;
	channelWeights?: ReadonlyArray<number>;
}

export interface SampleQuery extends Dimensions {
	startSample: number;
	endSample: number;
}

export interface PipelineOptions {
	metadata: SpectralMetadata;
	sampleQuery: SampleQuery;
	readSamples: (
		channel: number,
		sampleOffset: number,
		sampleCount: number,
		signal?: AbortSignal,
	) => Promise<Float32Array>;
	config: RequiredProperties<SpectralConfig, "device" | "signal">;
	onProgress?: (fraction: number) => void;
}

export interface ResolvedPipelineOptions extends PipelineOptions {
	config: SpectralConfig;
}

export interface PipelineResult {
	waveformBuffer: Float32Array;
	waveformPointCount: number;
	waveformSamplesPerPoint: number;
	loudnessData: LoudnessData | null;
	spectrogramTexture: GPUTexture | null;
	ltas: Float32Array | null;
	correlationEnvelope: Float32Array | null;
	vectorscopeHistogram: Uint32Array | null;
	options: ResolvedPipelineOptions;
}

export function computeSamplesPerPoint(
	windowSamples: number,
	width: number,
	sampleRate: number,
	loudness: boolean,
): number {
	if (loudness) {
		return Math.max(1, Math.round(sampleRate / WAVEFORM_POINTS_PER_SECOND));
	}

	return Math.max(1, Math.floor(windowSamples / (width * 2)));
}

const DEFAULT_CHUNK_SIZE = 131072;

declare const scheduler: { yield(): Promise<void> } | undefined;

function yieldControl(): Promise<void> {
	if (typeof scheduler !== "undefined" && typeof scheduler.yield === "function") {
		return scheduler.yield();
	}

	return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runPipeline(options: PipelineOptions, engine: SpectralEngine): Promise<PipelineResult> {
	const { metadata, readSamples, config } = options;
	const { sampleRate, channelCount } = metadata;
	const { startSample, endSample } = options.sampleQuery;
	const { signal } = config;

	const sampleCount = endSample - startSample;

	const resolvedConfig = resolveConfig(config);
	const { spectrogram, ltas, loudness, truePeak: computeTruePeak, stereo, channelInput } = resolvedConfig;

	signal.throwIfAborted();

	const sampleQuery = {
		...options.sampleQuery,
		...resolveRenderDimensions(options.sampleQuery, config.device, resolvedConfig.fftSize),
	};

	const samplesPerPoint = computeSamplesPerPoint(sampleCount, sampleQuery.width, sampleRate, loudness);
	const pointCount = Math.ceil(sampleCount / samplesPerPoint);
	const waveformSamplesPerPoint = computeSamplesPerPoint(sampleCount, sampleQuery.width, sampleRate, false);
	const waveformPointCount = Math.ceil(sampleCount / waveformSamplesPerPoint);

	const scanContext = createScanContext(
		metadata,
		pointCount,
		samplesPerPoint,
		DEFAULT_CHUNK_SIZE,
		loudness,
		computeTruePeak,
		stereo,
		channelInput,
		{ pointCount: waveformPointCount, samplesPerPoint: waveformSamplesPerPoint },
	);

	const effectiveFftSize = Math.min(resolvedConfig.fftSize, getMaxFftSize(config.device));
	const fftWindow = resolveFftContext(startSample, endSample, metadata.sampleCount, effectiveFftSize);
	const fftSampleCount = fftWindow.endSample - fftWindow.startSample;
	const supplementalFft = fftSampleCount > sampleCount;
	const sampling = resolvedConfig.spectrogramSampling ?? "full";
	const sampledFrameCount = sampling === "full" ? 0 : sampleQuery.width * sampling;
	const fullHop = computeHopSize(sampleCount, sampleQuery.width, effectiveFftSize, resolvedConfig.hopOverlap);
	const fullFrameCount = Math.floor((sampleCount - effectiveFftSize) / fullHop) + 1;
	const stratified =
		spectrogram &&
		!ltas &&
		sampledFrameCount > 0 &&
		sampledFrameCount < fullFrameCount &&
		Math.floor(sampleCount / sampledFrameCount) >= effectiveFftSize;
	const spectralContext =
		(spectrogram || ltas) && sampleCount > 0
			? await engine.prepare(
					stratified ? sampledFrameCount * effectiveFftSize : fftSampleCount,
					sampleRate,
					{ width: sampleQuery.width, height: sampleQuery.height },
					stratified ? { ...resolvedConfig, hopOverlap: 1 } : resolvedConfig,
				)
			: null;
	const sampler =
		stratified && spectralContext
			? new StratifiedSpectrogramSampler(
					sampleCount,
					sampledFrameCount,
					effectiveFftSize,
					Math.max(1, Math.floor(effectiveFftSize / resolvedConfig.hopOverlap)),
					(samples, count) => engine.submitChunk(samples, count, spectralContext),
				)
			: null;

	let offset = 0;

	try {
		while (offset < sampleCount) {
			signal.throwIfAborted();

			const chunkFrames = Math.min(DEFAULT_CHUNK_SIZE, sampleCount - offset);

			const channelBuffers = await Promise.all(
				Array.from({ length: channelCount }, (_, channel) =>
					readSamples(channel, startSample + offset, chunkFrames, signal),
				),
			);

			signal.throwIfAborted();

			if (channelBuffers.some((buffer) => buffer.length < chunkFrames)) {
				throw new Error(`Audio reader returned fewer than ${chunkFrames} samples`);
			}

			scanSamples(channelBuffers, chunkFrames, scanContext);

			if (spectralContext && !supplementalFft) {
				const fftInput = channelInput === "mono" ? scanContext.monoBuffer : scanContext.channelInputBuffer;

				if (sampler) sampler.consume(fftInput, chunkFrames);
				else engine.submitChunk(fftInput, chunkFrames, spectralContext);
			}

			offset += chunkFrames;

			if (sampleCount > 0) options.onProgress?.(offset / sampleCount);

			await yieldControl();
		}

		signal.throwIfAborted();
		sampler?.finish();

		if (spectralContext && supplementalFft) {
			const readStart = Math.max(0, fftWindow.startSample);
			const readEnd = Math.min(metadata.sampleCount, fftWindow.endSample);
			const readCount = readEnd - readStart;
			const channelBuffers = await Promise.all(
				Array.from({ length: channelCount }, async (_, channel) => {
					const samples = await readSamples(channel, readStart, readCount, signal);

					signal.throwIfAborted();

					if (samples.length < readCount) throw new Error(`Audio reader returned fewer than ${readCount} samples`);

					const padded = new Float32Array(fftSampleCount);

					padded.set(samples.subarray(0, readCount), readStart - fftWindow.startSample);

					return padded;
				}),
			);
			const fftScan = createScanContext(
				metadata,
				1,
				fftSampleCount,
				fftSampleCount,
				false,
				false,
				false,
				channelInput,
			);

			signal.throwIfAborted();
			scanSamples(channelBuffers, fftSampleCount, fftScan);
			engine.submitChunk(
				channelInput === "mono" ? fftScan.monoBuffer : fftScan.channelInputBuffer,
				fftSampleCount,
				spectralContext,
			);
		}
	} catch (error: unknown) {
		if (spectralContext) engine.cleanupContext(spectralContext);

		throw error;
	}

	const { overallPeak, overallRms, truePeak } = finalizeScan(scanContext);

	const loudnessData = loudness
		? computeLoudnessData(scanContext, overallPeak, overallRms, computeTruePeak ? truePeak : undefined)
		: null;

	let spectrogramTexture: GPUTexture | null = null;
	let ltasResult: Float32Array | null = null;

	if (spectralContext) {
		const finalizeResult = await engine.finalize(spectralContext, resolvedConfig);

		if (signal.aborted) {
			finalizeResult.spectrogramTexture?.destroy();
			signal.throwIfAborted();
		}

		spectrogramTexture = finalizeResult.spectrogramTexture;
		ltasResult = finalizeResult.ltas;
	}

	const resolvedOptions: ResolvedPipelineOptions = {
		...options,
		sampleQuery,
		config: resolvedConfig,
	};

	return {
		waveformBuffer: scanContext.waveformBuffer,
		waveformPointCount: scanContext.state.waveformPointIndex,
		waveformSamplesPerPoint,
		loudnessData,
		spectrogramTexture,
		ltas: ltasResult,
		correlationEnvelope: stereo ? scanContext.correlationEnvelope : null,
		vectorscopeHistogram: stereo ? scanContext.vectorscopeHistogram : null,
		options: resolvedOptions,
	};
}
