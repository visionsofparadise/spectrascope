import { useMemo } from "react";
import { NEUTRAL_LAYER_COLOR } from "../layers";
import type { Source } from "../source";
import type { AudioData } from "../spectral/types";

export const EMPTY_AUDIO_DATA: AudioData = {
	sampleRate: 48000,
	channels: 1,
	totalSamples: 0,
	durationMs: 0,
	readSamples: () => Promise.resolve(new Float32Array(0)),
};

export interface SourceWithAudio {
	readonly source: Source;
	readonly audioData: AudioData;
}

export function resolveVisibleSourceAudio(
	sources: ReadonlyArray<Source>,
	sourceAudio: ReadonlyMap<string, AudioData>,
): ReadonlyArray<SourceWithAudio> {
	const resolved: Array<SourceWithAudio> = [];

	for (const source of sources) {
		if (!source.visible) continue;

		const audioData = sourceAudio.get(source.id);

		if (audioData) {
			resolved.push({ source, audioData });
		}
	}

	return resolved;
}

export function useChromeSources(sources: ReadonlyArray<Source>, sourceAudio: ReadonlyMap<string, AudioData>) {
	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	return {
		renderableSources,
		chromeAudio: renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA,
		layerColor: renderableSources[0]?.source.layerColor ?? NEUTRAL_LAYER_COLOR,
	};
}
