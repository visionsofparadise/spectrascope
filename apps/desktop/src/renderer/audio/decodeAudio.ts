import type { AudioData } from "../workspace/spectral/types";
import { toMediaUrl } from "./mediaUrl";

/**
 * The result of decoding one audio file in the renderer.
 *
 * - `audioData` — the design-system `AudioData` shape (a `readSamples` PCM
 *   reader) consumed by the workspace views for spectrogram / waveform display.
 * - `audioBuffer` — the raw decoded Web Audio `AudioBuffer`, retained so the
 *   live `MixPlayer` can schedule it through an `AudioBufferSourceNode` without
 *   re-decoding the file. An `AudioBuffer` is context-independent — it survives
 *   the decoding `AudioContext` being closed and can be played from any other.
 */
export interface DecodedAudio {
	readonly audioData: AudioData;
	readonly audioBuffer: AudioBuffer;
}

/**
 * Decode a local audio file into the renderer's `DecodedAudio` shape.
 *
 * The file bytes are sourced over the `media://` custom protocol (registered
 * in the main process — see `main/mediaProtocol.ts`), so any absolute local
 * path is reachable from the renderer. `decodeAudioData` handles every format
 * Chromium supports (wav/mp3/flac/m4a/ogg…), so no transcode step is needed.
 *
 * The `media://` URL is built by the shared `toMediaUrl` helper (triple-slash,
 * encoded path — see `mediaUrl.ts` for why the raw form breaks on Windows).
 *
 * Mirrors the demo's `audioLoader.ts` `loadAudio` — the only difference is the
 * byte source (a `media://` URL instead of a public-asset `fetch`) and that the
 * raw `AudioBuffer` is kept alongside the `AudioData` for live playback.
 *
 * The returned `readSamples` hands out a zero-copy `subarray` view of the
 * decoded channel data — the same contract `useSpectralCompute` /
 * `SourceStrip` already consume.
 */
export async function decodeAudio(filePath: string): Promise<DecodedAudio> {
	const response = await fetch(toMediaUrl(filePath));

	if (!response.ok) {
		throw new Error(`Failed to fetch audio file (${response.status}): ${filePath}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	const audioContext = new AudioContext();

	let audioBuffer: AudioBuffer;

	try {
		audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
	} finally {
		void audioContext.close();
	}

	const sampleRate = audioBuffer.sampleRate;
	const channels = audioBuffer.numberOfChannels;
	const totalSamples = audioBuffer.length;
	const durationMs = (totalSamples / sampleRate) * 1000;

	const channelData: Array<Float32Array> = [];

	for (let channel = 0; channel < channels; channel++) {
		channelData.push(audioBuffer.getChannelData(channel));
	}

	const readSamples = (channel: number, sampleOffset: number, sampleCount: number): Promise<Float32Array> => {
		const samples = channelData[channel];

		if (!samples) {
			return Promise.resolve(new Float32Array(0));
		}

		const end = Math.min(sampleOffset + sampleCount, totalSamples);

		return Promise.resolve(samples.subarray(sampleOffset, end));
	};

	return {
		audioData: { sampleRate, channels, totalSamples, durationMs, readSamples },
		audioBuffer,
	};
}
