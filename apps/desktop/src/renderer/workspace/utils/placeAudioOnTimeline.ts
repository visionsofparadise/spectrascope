import type { AudioData } from "../spectral/types";

export function placeAudioOnTimeline(audioData: AudioData, offsetMs: number, durationMs: number): AudioData {
	const offsetSamples = Math.round((Math.max(0, offsetMs) * audioData.sampleRate) / 1000);
	const totalSamples = Math.max(0, Math.round((durationMs * audioData.sampleRate) / 1000));

	return {
		...audioData,
		totalSamples,
		durationMs: (totalSamples * 1000) / audioData.sampleRate,
		readSamples: async (channel, sampleOffset, sampleCount) => {
			const count = Math.max(0, Math.min(sampleCount, totalSamples - sampleOffset));
			const output = new Float32Array(count);
			const start = Math.max(sampleOffset, offsetSamples);
			const end = Math.min(sampleOffset + count, offsetSamples + audioData.totalSamples);

			if (end <= start) return output;

			const samples = await audioData.readSamples(channel, start - offsetSamples, end - start);

			output.set(samples.subarray(0, end - start), start - sampleOffset);

			return output;
		},
	};
}
