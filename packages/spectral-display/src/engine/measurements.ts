import { computeIntegratedLufs, computeMomentaryLufs, meanSquareToLufs } from "./loudness";
import { createScanContext, finalizeScan, scanSamples } from "./sample-scan";
import type { LoudnessData } from "./loudness";
import type { PipelineOptions, SpectralMetadata } from "./runPipeline";

export interface MeasurementData {
	readonly metadata: SpectralMetadata;
	readonly samplesPerPoint: number;
	readonly rms: Float32Array;
	readonly peaks: Float32Array;
	readonly truePeaks: Float32Array;
	readonly weightedEnergy: Float32Array;
	readonly momentaryLufs: Float32Array;
	readonly shortTermLufs: Float32Array;
	readonly leftEnergy: Float32Array;
	readonly rightEnergy: Float32Array;
	readonly crossEnergy: Float32Array;
	readonly vectorscopeHistogram: Uint32Array;
}

export async function analyzeMeasurements(
	metadata: SpectralMetadata,
	readSamples: PipelineOptions["readSamples"],
	signal: AbortSignal,
	onProgress: (fraction: number) => void,
): Promise<MeasurementData> {
	const samplesPerPoint = Math.max(1, Math.round(metadata.sampleRate / 500));
	const pointCount = Math.ceil(metadata.sampleCount / samplesPerPoint);
	const chunkSize = 65536;
	const context = createScanContext(metadata, pointCount, samplesPerPoint, chunkSize, true, true, true, "mono", {
		pointCount: 0,
		samplesPerPoint,
	});

	for (let offset = 0; offset < metadata.sampleCount; offset += chunkSize) {
		signal.throwIfAborted();

		const count = Math.min(chunkSize, metadata.sampleCount - offset);
		const channels = await Promise.all(
			Array.from({ length: metadata.channelCount }, (_, channel) => readSamples(channel, offset, count, signal)),
		);

		signal.throwIfAborted();

		if (channels.some((channel) => channel.length !== count)) throw new Error("Incomplete measurement audio read");

		scanSamples(channels, count, context);
		onProgress((offset + count) / metadata.sampleCount);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}

	finalizeScan(context);
	signal.throwIfAborted();

	return {
		metadata,
		samplesPerPoint,
		rms: context.rmsEnvelope,
		peaks: context.peakEnvelope,
		truePeaks: context.truePeakEnvelope,
		weightedEnergy: context.kWeightedMeanSquare,
		momentaryLufs: computeMomentaryLufs(
			context.kWeightedMeanSquare,
			Math.max(1, Math.round((metadata.sampleRate / samplesPerPoint) * 0.4)),
		),
		shortTermLufs: computeMomentaryLufs(
			context.kWeightedMeanSquare,
			Math.max(1, Math.round((metadata.sampleRate / samplesPerPoint) * 3)),
		),
		leftEnergy: context.stereoLeftEnergy,
		rightEnergy: context.stereoRightEnergy,
		crossEnergy: context.stereoCrossEnergy,
		vectorscopeHistogram: context.vectorscopeHistogram,
	};
}

export function selectMeasurements(data: MeasurementData, startSample: number, endSample: number) {
	const { samplesPerPoint, metadata } = data;
	const first = Math.max(0, Math.min(data.rms.length, Math.floor(startSample / samplesPerPoint)));
	const last = Math.max(first, Math.min(data.rms.length, Math.ceil(endSample / samplesPerPoint)));
	const start = Math.min(metadata.sampleCount, first * samplesPerPoint);
	const end = Math.min(metadata.sampleCount, last * samplesPerPoint);
	const energies = data.weightedEnergy.subarray(first, last);
	const pointsPerSecond = metadata.sampleRate / samplesPerPoint;
	const momentaryPoints = Math.max(1, Math.round(pointsPerSecond * 0.4));
	const stepPoints = Math.max(1, Math.round(pointsPerSecond * 0.1));
	const blocks: Array<number> = [];
	let blockEnergy = 0;

	for (let index = 0; index < energies.length; index++) {
		blockEnergy += energies[index]!;

		if (index >= momentaryPoints) blockEnergy -= energies[index - momentaryPoints]!;

		if (index >= momentaryPoints - 1 && (index - momentaryPoints + 1) % stepPoints === 0)
			blocks.push(meanSquareToLufs(blockEnergy / momentaryPoints));
	}

	let sumSquares = 0;
	let peak = 0;
	let truePeak = 0;
	const correlationEnvelope = new Float32Array(last - first);

	for (let index = first; index < last; index++) {
		const count = Math.min(samplesPerPoint, metadata.sampleCount - index * samplesPerPoint);

		sumSquares += data.rms[index]! ** 2 * count;
		peak = Math.max(peak, data.peaks[index]!);
		truePeak = Math.max(truePeak, data.truePeaks[index]!);

		const left = data.leftEnergy[index]!;
		const right = data.rightEnergy[index]!;

		correlationEnvelope[index - first] =
			left < 1e-12 || right < 1e-12
				? NaN
				: Math.max(-1, Math.min(1, data.crossEnergy[index]! / Math.sqrt(left * right)));
	}

	const rms = end > start ? Math.sqrt(sumSquares / (end - start)) : 0;
	const toDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
	const loudnessData: LoudnessData = {
		rmsEnvelope: data.rms.subarray(first, last),
		peakEnvelope: data.peaks.subarray(first, last),
		momentaryLufs: data.momentaryLufs.subarray(first, last),
		shortTermLufs: data.shortTermLufs.subarray(first, last),
		integratedLufs: computeIntegratedLufs(new Float32Array(blocks)),
		peakDb: toDb(peak),
		truePeak,
		truePeakDb: toDb(truePeak),
		rmsDb: toDb(rms),
		crestFactor: rms > 0 ? toDb(peak / rms) : 0,
		pointCount: last - first,
	};

	return { startSample: start, endSample: end, loudnessData, correlationEnvelope };
}
