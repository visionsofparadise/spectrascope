import type { AudioData } from "../spectral/types";

const placements = new WeakMap<AudioData, Map<string, AudioData>>();
const MAX_PLACEMENTS_PER_SOURCE = 8;

export function placeAudioOnTimeline(audioData: AudioData, offsetMs: number, durationMs: number): AudioData {
	const offsetSamples = Math.round((Math.max(0, offsetMs) * audioData.sampleRate) / 1000);
	const totalSamples = Math.max(0, Math.round((durationMs * audioData.sampleRate) / 1000));

	if (offsetSamples === 0 && totalSamples === audioData.totalSamples) return audioData;

	let cache = placements.get(audioData);

	if (!cache) {
		cache = new Map();
		placements.set(audioData, cache);
	}

	const key = `${offsetSamples}:${totalSamples}`;
	const cached = cache.get(key);

	if (cached) {
		cache.delete(key);
		cache.set(key, cached);

		return cached;
	}

	const placed: AudioData = {
		...audioData,
		timelinePlacement: { source: audioData, offsetSamples },
		totalSamples,
		durationMs: (totalSamples * 1000) / audioData.sampleRate,
		readSamples: async (channel, sampleOffset, sampleCount, signal) => {
			signal?.throwIfAborted();

			const count = Math.max(0, Math.min(sampleCount, totalSamples - sampleOffset));
			const output = new Float32Array(count);
			const start = Math.max(sampleOffset, offsetSamples);
			const end = Math.min(sampleOffset + count, offsetSamples + audioData.totalSamples);

			if (end <= start) return output;

			const samples = await audioData.readSamples(channel, start - offsetSamples, end - start, signal);

			signal?.throwIfAborted();

			output.set(samples.subarray(0, end - start), start - sampleOffset);

			return output;
		},
	};

	cache.set(key, placed);

	if (cache.size > MAX_PLACEMENTS_PER_SOURCE) {
		const oldest = cache.keys().next().value;

		if (oldest !== undefined) cache.delete(oldest);
	}

	return placed;
}
