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
			const startByte = sampleOffset * 4;
			const endByte = (sampleOffset + sampleCount) * 4 - 1;

			const response = await fetch(streamUrl(info.key, "raw", channel), {
				headers: { Range: `bytes=${String(startByte)}-${String(endByte)}` },
			});

			if (!response.ok) return new Float32Array(sampleCount);

			const buffer = await response.arrayBuffer();

			return new Float32Array(buffer);
		},
	};
}
