import { PcmBlockCache } from "./utils/PcmBlockCache";
import type { StreamInfo } from "../../main/StreamManager";
import type { AudioData } from "../workspace/spectral/types";

const blocks = new PcmBlockCache();

export type StreamFlavor = "raw" | "wav";

export function streamUrl(key: string, flavor: StreamFlavor, channel?: number): string {
	if (flavor === "wav") {
		return `media://stream/${key}/audio.wav`;
	}

	return `media://stream/${key}/raw/${String(channel ?? 0)}`;
}

export function createStreamAudioData(info: StreamInfo): AudioData {
	const blockFrames = Math.max(1, Math.min(65536, Math.floor((1024 * 1024) / (info.channelCount * 4))));
	const sourceKey = JSON.stringify([info.key, info.sampleRate, info.channelCount, info.totalFrames]);

	return {
		sampleRate: info.sampleRate,
		channels: info.channelCount,
		totalSamples: info.totalFrames,
		durationMs: info.durationMs,
		readSamples: async (channel, sampleOffset, sampleCount, signal) => {
			signal?.throwIfAborted();

			if (!Number.isInteger(channel) || channel < 0 || channel >= info.channelCount)
				throw new Error("Invalid audio channel");

			if (!Number.isSafeInteger(sampleOffset) || !Number.isSafeInteger(sampleCount) || sampleCount < 0)
				throw new Error("Invalid audio sample range");

			const samples = new Float32Array(sampleCount);
			const start = Math.max(0, sampleOffset);
			const end = Math.min(info.totalFrames, sampleOffset + sampleCount);

			if (end <= start) return samples;

			for (
				let blockStart = Math.floor(start / blockFrames) * blockFrames;
				blockStart < end;
				blockStart += blockFrames
			) {
				const blockEnd = Math.min(info.totalFrames, blockStart + blockFrames);
				const interleaved = await blocks.read(
					`${sourceKey}:${String(blockStart)}`,
					async (blockSignal) => {
						const startByte = blockStart * info.channelCount * 4;
						const endByte = blockEnd * info.channelCount * 4 - 1;
						const response = await fetch(`media://stream/${info.key}/raw/interleaved`, {
							headers: { Range: `bytes=${String(startByte)}-${String(endByte)}` },
							signal: blockSignal,
						});

						blockSignal.throwIfAborted();

						if (!response.ok)
							throw new Error(`Audio read failed (${String(response.status)} ${response.statusText})`);

						const buffer = await response.arrayBuffer();

						blockSignal.throwIfAborted();

						if (buffer.byteLength !== (blockEnd - blockStart) * info.channelCount * 4)
							throw new Error("Audio read returned an incomplete sample range");

						return new Float32Array(buffer);
					},
					signal,
				);

				signal?.throwIfAborted();

				for (let frame = Math.max(start, blockStart); frame < Math.min(end, blockEnd); frame++) {
					samples[frame - sampleOffset] = interleaved[(frame - blockStart) * info.channelCount + channel] ?? 0;
				}
			}

			return samples;
		},
	};
}
