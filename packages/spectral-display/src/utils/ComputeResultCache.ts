import { retainTexture } from "./textureOwnership";
import type { ComputeResultReady } from "../useSpectralCompute";

interface CacheEntry {
	readonly result: ComputeResultReady;
	readonly bytes: number;
	readonly overview: boolean;
	readonly release?: () => void;
}

function resultBytes(result: ComputeResultReady): number {
	const buffers = new Set<ArrayBufferLike>();
	const values = [
		result.waveformBuffer,
		result.ltas,
		result.correlationEnvelope,
		result.vectorscopeHistogram,
		result.loudnessData?.rmsEnvelope,
		result.loudnessData?.peakEnvelope,
		result.loudnessData?.momentaryLufs,
		result.loudnessData?.shortTermLufs,
	];

	for (const value of values) {
		if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
	}

	const { width, height } = result.options.sampleQuery;
	let bytes = result.spectrogramTexture ? width * height * 4 : 0;

	for (const buffer of buffers) bytes += buffer.byteLength;

	return bytes;
}

export class ComputeResultCache {
	private readonly entries = new Map<string, CacheEntry>();
	private bytes = 0;

	constructor(
		private readonly maximumBytes = 64 * 1024 * 1024,
		private readonly maximumEntries = 8,
	) {}

	get(key: string): ComputeResultReady | undefined {
		const entry = this.entries.get(key);

		if (!entry) return undefined;

		this.entries.delete(key);
		this.entries.set(key, entry);

		return entry.result;
	}

	set(key: string, result: ComputeResultReady): void {
		const bytes = resultBytes(result);

		if (!Number.isFinite(bytes) || bytes > this.maximumBytes || this.maximumEntries <= 0) return;

		const release = result.spectrogramTexture ? retainTexture(result.spectrogramTexture) : undefined;
		const { startSample, endSample } = result.options.sampleQuery;

		this.remove(key);
		this.entries.set(key, {
			result,
			bytes,
			overview: startSample === 0 && endSample === result.options.metadata.sampleCount,
			release,
		});
		this.bytes += bytes;

		while (this.bytes > this.maximumBytes || this.entries.size > this.maximumEntries) {
			const entries = [...this.entries];
			const oldest = entries.find(([, entry]) => !entry.overview) ?? entries[0];

			if (!oldest) break;

			this.remove(oldest[0]);
		}
	}

	clear(): void {
		for (const key of this.entries.keys()) this.remove(key);
	}

	private remove(key: string): void {
		const entry = this.entries.get(key);

		if (!entry) return;

		this.entries.delete(key);
		this.bytes -= entry.bytes;
		entry.release?.();
	}
}
