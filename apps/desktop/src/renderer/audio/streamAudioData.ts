import type { StreamInfo } from "../../main/StreamManager";
import type { AudioData } from "../workspace/spectral/types";

export type StreamFlavor = "raw" | "wav";

export function streamUrl(key: string, flavor: StreamFlavor, channel?: number): string {
	if (flavor === "wav") {
		return `media://stream/${key}/audio.wav`;
	}

	return `media://stream/${key}/raw/${String(channel ?? 0)}`;
}

export function createStreamAudioData(info: StreamInfo): AudioData {
	return {
		sampleRate: info.sampleRate,
		channels: info.channelCount,
		totalSamples: info.totalFrames,
		durationMs: info.durationMs,
		readSamples: async (channel, sampleOffset, sampleCount) => {
			if (!Number.isInteger(channel) || channel < 0 || channel >= info.channelCount)
				throw new Error("Invalid audio channel");

			if (!Number.isSafeInteger(sampleOffset) || !Number.isSafeInteger(sampleCount) || sampleCount < 0)
				throw new Error("Invalid audio sample range");

			const samples = new Float32Array(sampleCount);
			const start = Math.max(0, sampleOffset);
			const end = Math.min(info.totalFrames, sampleOffset + sampleCount);

			if (end <= start) return samples;

			const startByte = start * 4;
			const endByte = end * 4 - 1;

			const response = await fetch(streamUrl(info.key, "raw", channel), {
				headers: { Range: `bytes=${String(startByte)}-${String(endByte)}` },
			});

			if (!response.ok) throw new Error(`Audio read failed (${String(response.status)} ${response.statusText})`);

			const buffer = await response.arrayBuffer();

			if (buffer.byteLength !== (end - start) * 4) throw new Error("Audio read returned an incomplete sample range");

			samples.set(new Float32Array(buffer), start - sampleOffset);

			return samples;
		},
	};
}
