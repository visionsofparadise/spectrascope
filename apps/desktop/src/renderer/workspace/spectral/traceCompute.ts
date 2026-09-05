import { useMemo } from "react";
import { useSpectralCompute } from "spectral-display";
import { heldComputeResult } from "./computeResult";
import type { AudioData } from "./types";
import type { SpectralOptions } from "spectral-display";

const PROBE_SIZE = 64;

export function useTraceCompute(
	audioData: AudioData,
	startMs: number,
	endMs: number,
	config: SpectralOptions["config"],
) {
	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			query: { startMs, endMs, width: PROBE_SIZE, height: PROBE_SIZE },
			readSamples: audioData.readSamples,
			config,
		}),
		[audioData.sampleRate, audioData.totalSamples, audioData.channels, audioData.readSamples, startMs, endMs, config],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	return { computeResult, renderable: heldComputeResult(computeResult) };
}
