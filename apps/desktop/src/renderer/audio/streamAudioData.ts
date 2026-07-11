import type { StreamInfo } from "../../main/StreamManager";
import type { AudioData } from "../workspace/spectral/types";

/**
 * The two flavors a registered `media://stream/<key>/…` serves:
 * - `raw` — headerless per-channel f32 (`raw/<channel>`), Range-addressable in
 *   bytes (sample × 4). This is what `readSamples` fetches for analysis.
 * - `wav` — the WAV/RF64 playback body (`audio.wav`), interleaved, for a media
 *   element. Phase 5.1 points `PlaybackEngine` at this.
 */
export type StreamFlavor = "raw" | "wav";

/**
 * Build a `media://` URL for a registered stream. The raw flavor is per-channel,
 * so `channel` selects which channel's f32 the URL serves (defaulting to 0); the
 * wav flavor is interleaved and ignores `channel`.
 */
export function streamUrl(key: string, flavor: StreamFlavor, channel?: number): string {
	if (flavor === "wav") {
		return `media://stream/${key}/audio.wav`;
	}

	return `media://stream/${key}/raw/${String(channel ?? 0)}`;
}

/**
 * Adapt a registered stream's `StreamInfo` to the views' `AudioData` seam. The
 * metadata comes straight from registration; `readSamples(channel, offset,
 * count)` is a thin Range `fetch` against the raw flavor — frame N of channel C
 * is bytes `[N*4, N*4+4)` of `raw/<C>`, so the requested window is the byte
 * range `[offset*4, (offset+count)*4)` (inclusive-end Range header). The main
 * process computes and serves exactly those bytes on demand; nothing is held in
 * renderer memory.
 */
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

			// An evicted or unknown stream key 404s with a non-PCM error body; treat
			// it as silence for the requested window rather than letting a
			// non-multiple-of-4 body throw in the Float32Array view.
			if (!response.ok) return new Float32Array(sampleCount);

			const buffer = await response.arrayBuffer();

			return new Float32Array(buffer);
		},
	};
}
