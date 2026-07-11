import type { RequiredProperties } from "../utils/RequiredProperties";
import { resolveConfig, type Dimensions, type SpectralConfig, type SpectralEngine } from "./SpectralEngine";
import type { LoudnessData } from "./loudness";
import { computeLoudnessData, WAVEFORM_POINTS_PER_SECOND } from "./loudness";
import { createScanContext, finalizeScan, scanSamples } from "./sample-scan";

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
	readSamples: (channel: number, sampleOffset: number, sampleCount: number) => Promise<Float32Array>;
	config: RequiredProperties<SpectralConfig, "device" | "signal">;
}

export interface ResolvedPipelineOptions extends PipelineOptions {
	config: SpectralConfig;
}

export interface PipelineResult {
	waveformBuffer: Float32Array;
	waveformPointCount: number;
	loudnessData: LoudnessData | null;
	spectrogramTexture: GPUTexture | null;
	/** Mean magnitude per band across the query window; null unless `ltas` was set. */
	ltas: Float32Array | null;
	/** Per-point inter-channel correlation envelope; null unless `stereo` was set. */
	correlationEnvelope: Float32Array | null;
	/** Whole-clip (Side, Mid) density histogram; null unless `stereo` was set. */
	vectorscopeHistogram: Uint32Array | null;
	options: ResolvedPipelineOptions;
}

/**
 * Waveform scan density. Loudness pins 500 pts/sec (LUFS window math assumes it);
 * otherwise density is query-derived at ~2 points per output pixel column.
 */
export function computeSamplesPerPoint(windowSamples: number, width: number, sampleRate: number, loudness: boolean): number {
	if (loudness) {
		return Math.round(sampleRate / WAVEFORM_POINTS_PER_SECOND);
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
	const { metadata, sampleQuery, readSamples, config } = options;
	const { sampleRate, channelCount } = metadata;
	const { startSample, endSample } = sampleQuery;
	const { signal } = config;

	const sampleCount = endSample - startSample;

	const resolvedConfig = resolveConfig(config);
	const { spectrogram, ltas, loudness, truePeak: computeTruePeak, stereo, channelInput } = resolvedConfig;

	const samplesPerPoint = computeSamplesPerPoint(sampleCount, sampleQuery.width, sampleRate, loudness);
	const pointCount = Math.ceil(sampleCount / samplesPerPoint);

	const scanContext = createScanContext(metadata, pointCount, samplesPerPoint, DEFAULT_CHUNK_SIZE, loudness, computeTruePeak, stereo, channelInput);

	const spectralContext = spectrogram || ltas ? await engine.prepare(sampleCount, sampleRate, resolvedConfig) : null;

	let offset = 0;

	try {
		while (offset < sampleCount) {
			if (signal.aborted) {
				if (spectralContext) engine.cleanupContext(spectralContext);

				throw new DOMException("Aborted", "AbortError");
			}

			const chunkFrames = Math.min(DEFAULT_CHUNK_SIZE, sampleCount - offset);

			const channelBuffers = await Promise.all(Array.from({ length: channelCount }, (_, ch) => readSamples(ch, startSample + offset, chunkFrames)));

			scanSamples(channelBuffers, chunkFrames, scanContext);

			if (spectralContext) {
				// "mono" feeds the FFT the cross-channel mono mix; "mid"/"side"
				// feed the derived signal scanSamples wrote into channelInputBuffer.
				const fftInput = channelInput === "mono" ? scanContext.monoBuffer : scanContext.channelInputBuffer;

				engine.submitChunk(fftInput, chunkFrames, spectralContext);
			}

			offset += chunkFrames;

			await yieldControl();
		}
	} catch (error: unknown) {
		if (spectralContext) engine.cleanupContext(spectralContext);

		throw error;
	}

	const { overallPeak, overallRms, truePeak } = finalizeScan(scanContext);

	const loudnessData = loudness ? computeLoudnessData(scanContext, overallPeak, overallRms, computeTruePeak ? truePeak : undefined) : null;

	let spectrogramTexture: GPUTexture | null = null;
	let ltasResult: Float32Array | null = null;

	if (spectralContext) {
		const finalizeResult = await engine.finalize(sampleQuery, spectralContext, resolvedConfig);

		spectrogramTexture = finalizeResult.spectrogramTexture;
		ltasResult = finalizeResult.ltas;
	}

	const resolvedOptions: ResolvedPipelineOptions = {
		...options,
		config: resolvedConfig,
	};

	return {
		waveformBuffer: scanContext.waveformBuffer,
		waveformPointCount: scanContext.state.pointIndex,
		loudnessData,
		spectrogramTexture,
		ltas: ltasResult,
		correlationEnvelope: stereo ? scanContext.correlationEnvelope : null,
		vectorscopeHistogram: stereo ? scanContext.vectorscopeHistogram : null,
		options: resolvedOptions,
	};
}
