import type { PipelineOptions } from "../engine/runPipeline";

interface WaveformTile {
	readonly entries: Set<WaveformTile>;
	readonly key: string;
	readonly startSample: number;
	readonly endSample: number;
	readonly samplesPerPoint: number;
	readonly waveform: Float32Array;
	readonly energy: Float64Array;
	readonly bytes: number;
}

export interface CachedWaveform {
	readonly waveformBuffer: Float32Array;
	readonly waveformEnergyBuffer: Float64Array;
	readonly waveformSamplesPerPoint: number;
	readonly waveformPointCount: number;
}

export class WaveformTileCache {
	private readonly owners = new WeakMap<PipelineOptions["readSamples"], Set<WaveformTile>>();
	private readonly entries = new Set<WaveformTile>();
	private bytes = 0;

	constructor(
		private readonly maxBytes = 64 * 1024 * 1024,
		private readonly maxEntries = 256,
	) {}

	set(
		owner: PipelineOptions["readSamples"],
		key: string,
		startSample: number,
		endSample: number,
		samplesPerPoint: number,
		waveform: Float32Array,
		energy: Float64Array,
	): void {
		if (!this.validRange(startSample, endSample, samplesPerPoint)) return;

		const count = Math.ceil((endSample - startSample) / samplesPerPoint);
		const bytes = count * 16;

		if (waveform.length !== count * 2 || energy.length !== count || bytes > this.maxBytes || this.maxEntries < 1)
			return;

		let entries = this.owners.get(owner);

		if (!entries) {
			entries = new Set();
			this.owners.set(owner, entries);
		}

		for (const entry of entries) {
			if (
				entry.key === key &&
				entry.startSample === startSample &&
				entry.endSample === endSample &&
				entry.samplesPerPoint === samplesPerPoint
			)
				this.remove(entry);
		}

		const entry = {
			entries,
			key,
			startSample,
			endSample,
			samplesPerPoint,
			waveform: waveform.slice(),
			energy: energy.slice(),
			bytes,
		};

		entries.add(entry);
		this.entries.add(entry);
		this.bytes += bytes;

		while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries)
			this.remove(this.entries.values().next().value!);
	}

	get(
		owner: PipelineOptions["readSamples"],
		key: string,
		startSample: number,
		endSample: number,
		samplesPerPoint: number,
	): CachedWaveform | undefined {
		if (!this.validRange(startSample, endSample, samplesPerPoint)) return;

		const candidates = [...(this.owners.get(owner) ?? [])]
			.filter(
				(entry) =>
					entry.key === key &&
					samplesPerPoint % entry.samplesPerPoint === 0 &&
					entry.endSample > startSample &&
					entry.startSample < endSample,
			)
			.sort((first, second) => second.samplesPerPoint - first.samplesPerPoint);

		if (!candidates.length) return;

		const count = Math.ceil((endSample - startSample) / samplesPerPoint);
		const waveformBuffer = new Float32Array(count * 2);
		const waveformEnergyBuffer = new Float64Array(count);
		const used = new Set<WaveformTile>();

		for (let point = 0; point < count; point++) {
			let cursor = startSample + point * samplesPerPoint;
			const end = Math.min(endSample, cursor + samplesPerPoint);
			let minimum = Infinity;
			let maximum = -Infinity;
			let energy = 0;

			while (cursor < end) {
				const entry = candidates.find((candidate) => {
					if (
						candidate.startSample > cursor ||
						candidate.endSample <= cursor ||
						cursor % candidate.samplesPerPoint !== 0
					)
						return false;

					const next = Math.min(candidate.endSample, cursor + candidate.samplesPerPoint);

					return next <= end && (next - cursor === candidate.samplesPerPoint || next === endSample);
				});

				if (!entry) return;

				const index = (cursor - entry.startSample) / entry.samplesPerPoint;

				minimum = Math.min(minimum, entry.waveform[index * 2]!);
				maximum = Math.max(maximum, entry.waveform[index * 2 + 1]!);
				energy += entry.energy[index]!;
				cursor = Math.min(entry.endSample, cursor + entry.samplesPerPoint);
				used.add(entry);
			}

			waveformBuffer[point * 2] = minimum;
			waveformBuffer[point * 2 + 1] = maximum;
			waveformEnergyBuffer[point] = energy;
		}

		for (const entry of used) {
			this.entries.delete(entry);
			this.entries.add(entry);
		}

		return {
			waveformBuffer,
			waveformEnergyBuffer,
			waveformSamplesPerPoint: samplesPerPoint,
			waveformPointCount: count,
		};
	}

	private validRange(start: number, end: number, samplesPerPoint: number): boolean {
		return (
			Number.isSafeInteger(start) &&
			Number.isSafeInteger(end) &&
			Number.isSafeInteger(samplesPerPoint) &&
			samplesPerPoint > 0 &&
			start >= 0 &&
			end > start &&
			start % samplesPerPoint === 0
		);
	}

	private remove(entry: WaveformTile): void {
		this.entries.delete(entry);
		entry.entries.delete(entry);
		this.bytes -= entry.bytes;
	}
}
