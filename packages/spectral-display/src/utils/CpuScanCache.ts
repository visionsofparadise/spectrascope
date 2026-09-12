import type { PipelineOptions, PipelineResult } from "../engine/runPipeline";
import type { ChannelInput } from "../engine/SpectralEngine";

type CpuScanData = Pick<
	PipelineResult,
	| "waveformBuffer"
	| "waveformPointCount"
	| "waveformSamplesPerPoint"
	| "loudnessData"
	| "correlationEnvelope"
	| "vectorscopeHistogram"
>;

interface ScanRequest {
	readonly metadata: PipelineOptions["metadata"];
	readonly readSamples: PipelineOptions["readSamples"];
	readonly startSample: number;
	readonly endSample: number;
	readonly channelInput: ChannelInput;
	readonly waveformSamplesPerPoint: number;
	readonly measurementSamplesPerPoint: number;
	readonly loudness: boolean;
	readonly truePeak: boolean;
	readonly stereo: boolean;
}

interface CacheEntry {
	readonly owner: Set<CacheEntry>;
	readonly key: string;
	readonly data: CpuScanData;
	readonly measurementSamplesPerPoint: number;
	readonly truePeak: boolean;
	readonly bytes: number;
}

function scanKey(request: ScanRequest): string {
	const { metadata, startSample, endSample, channelInput } = request;

	return JSON.stringify([
		metadata.sampleRate,
		metadata.sampleCount,
		metadata.channelCount,
		metadata.channelWeights ?? null,
		startSample,
		endSample,
		channelInput,
	]);
}

function scanBytes(data: CpuScanData): number {
	let bytes = 0;

	for (const value of [
		data.waveformBuffer,
		data.correlationEnvelope,
		data.vectorscopeHistogram,
		data.loudnessData?.rmsEnvelope,
		data.loudnessData?.peakEnvelope,
		data.loudnessData?.momentaryLufs,
		data.loudnessData?.shortTermLufs,
	]) {
		if (value) bytes += value.byteLength;
	}

	return bytes;
}

function copyLoudness(data: CpuScanData["loudnessData"]): CpuScanData["loudnessData"] {
	return data
		? {
				...data,
				rmsEnvelope: data.rmsEnvelope.slice(),
				peakEnvelope: data.peakEnvelope.slice(),
				momentaryLufs: data.momentaryLufs.slice(),
				shortTermLufs: data.shortTermLufs.slice(),
			}
		: null;
}

function copyScan(data: CpuScanData): CpuScanData {
	return {
		waveformBuffer: data.waveformBuffer.slice(),
		waveformPointCount: data.waveformPointCount,
		waveformSamplesPerPoint: data.waveformSamplesPerPoint,
		loudnessData: copyLoudness(data.loudnessData),
		correlationEnvelope: data.correlationEnvelope?.slice() ?? null,
		vectorscopeHistogram: data.vectorscopeHistogram?.slice() ?? null,
	};
}

export class CpuScanCache {
	private readonly readers = new WeakMap<PipelineOptions["readSamples"], Set<CacheEntry>>();
	private readonly entries = new Set<CacheEntry>();
	private bytes = 0;

	constructor(
		private readonly maximumBytes = 64 * 1024 * 1024,
		private readonly maximumEntries = 32,
		private readonly maximumReaderEntries = 8,
	) {}

	get(request: ScanRequest): CpuScanData | undefined {
		const owner = this.readers.get(request.readSamples);

		if (!owner) return undefined;

		const key = scanKey(request);
		const entry = [...owner].reverse().find((candidate) => {
			const { data } = candidate;

			return (
				candidate.key === key &&
				request.waveformSamplesPerPoint >= data.waveformSamplesPerPoint &&
				request.waveformSamplesPerPoint % data.waveformSamplesPerPoint === 0 &&
				(!request.loudness ||
					(data.loudnessData !== null &&
						candidate.measurementSamplesPerPoint === request.measurementSamplesPerPoint)) &&
				(!request.truePeak || candidate.truePeak) &&
				(!request.stereo ||
					(data.correlationEnvelope !== null &&
						data.vectorscopeHistogram !== null &&
						candidate.measurementSamplesPerPoint === request.measurementSamplesPerPoint))
			);
		});

		if (!entry) return undefined;

		this.entries.delete(entry);
		this.entries.add(entry);
		owner.delete(entry);
		owner.add(entry);

		const { data } = entry;
		const waveformPointCount = Math.ceil((request.endSample - request.startSample) / request.waveformSamplesPerPoint);
		const ratio = request.waveformSamplesPerPoint / data.waveformSamplesPerPoint;
		const waveformBuffer = ratio === 1 ? data.waveformBuffer.slice() : new Float32Array(waveformPointCount * 2);

		if (ratio !== 1) {
			for (let point = 0; point < waveformPointCount; point++) {
				let minimum = Infinity;
				let maximum = -Infinity;
				const end = Math.min((point + 1) * ratio, data.waveformPointCount);

				for (let source = point * ratio; source < end; source++) {
					minimum = Math.min(minimum, data.waveformBuffer[source * 2]!);
					maximum = Math.max(maximum, data.waveformBuffer[source * 2 + 1]!);
				}

				waveformBuffer[point * 2] = minimum;
				waveformBuffer[point * 2 + 1] = maximum;
			}
		}

		const loudnessData = request.loudness ? copyLoudness(data.loudnessData) : null;

		if (loudnessData && !request.truePeak) {
			delete loudnessData.truePeak;
			delete loudnessData.truePeakDb;
		}

		return {
			waveformBuffer,
			waveformPointCount,
			waveformSamplesPerPoint: request.waveformSamplesPerPoint,
			loudnessData,
			correlationEnvelope: request.stereo ? (data.correlationEnvelope?.slice() ?? null) : null,
			vectorscopeHistogram: request.stereo ? (data.vectorscopeHistogram?.slice() ?? null) : null,
		};
	}

	set(request: ScanRequest, data: CpuScanData): void {
		const bytes = scanBytes(data);

		if (bytes > this.maximumBytes || this.maximumEntries <= 0 || this.maximumReaderEntries <= 0) return;

		let owner = this.readers.get(request.readSamples);

		if (!owner) {
			owner = new Set();
			this.readers.set(request.readSamples, owner);
		}

		const key = scanKey(request);

		for (const entry of owner) {
			if (
				entry.key === key &&
				entry.data.waveformSamplesPerPoint === data.waveformSamplesPerPoint &&
				entry.measurementSamplesPerPoint === request.measurementSamplesPerPoint &&
				entry.truePeak === request.truePeak &&
				(entry.data.loudnessData !== null) === (data.loudnessData !== null) &&
				(entry.data.correlationEnvelope !== null) === (data.correlationEnvelope !== null)
			)
				this.remove(entry);
		}

		const ownedData = copyScan(data);
		const entry = {
			owner,
			key,
			data: ownedData,
			bytes: scanBytes(ownedData),
			measurementSamplesPerPoint: request.measurementSamplesPerPoint,
			truePeak: request.truePeak,
		};

		owner.add(entry);
		this.entries.add(entry);
		this.bytes += entry.bytes;

		while (owner.size > this.maximumReaderEntries) {
			const oldest = owner.values().next().value;

			if (oldest) this.remove(oldest);
		}

		while (this.bytes > this.maximumBytes || this.entries.size > this.maximumEntries) {
			const oldest = this.entries.values().next().value;

			if (oldest) this.remove(oldest);
		}
	}

	private remove(entry: CacheEntry): void {
		entry.owner.delete(entry);
		this.entries.delete(entry);
		this.bytes -= entry.bytes;
	}
}
