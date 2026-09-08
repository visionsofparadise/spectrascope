import { useMemo, useRef } from "react";
import { NEUTRAL_LAYER_COLOR } from "../layers";
import { placeAudioOnTimeline } from "../utils/placeAudioOnTimeline";
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

function useChromeSources(sources: ReadonlyArray<Source>, sourceAudio: ReadonlyMap<string, AudioData>) {
	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	return {
		renderableSources,
		chromeAudio: renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA,
		layerColor: renderableSources[0]?.source.layerColor ?? NEUTRAL_LAYER_COLOR,
	};
}

export function comparisonDurationOf(sources: ReadonlyArray<SourceWithAudio>): number {
	return sources.reduce(
		(duration, { source, audioData }) =>
			Math.max(duration, Math.max(0, source.timelineOffsetMs) + audioData.durationMs),
		0,
	);
}

export function useTimelineChromeSources(sources: ReadonlyArray<Source>, sourceAudio: ReadonlyMap<string, AudioData>) {
	const { renderableSources: rawSources, layerColor } = useChromeSources(sources, sourceAudio);
	const cacheRef = useRef(
		new Map<string, { original: AudioData; offsetMs: number; durationMs: number; audioData: AudioData }>(),
	);
	const durationMs = comparisonDurationOf(rawSources);
	const renderableSources = useMemo(() => {
		const previous = cacheRef.current;
		const next: typeof previous = new Map();
		const resolved = rawSources.map(({ source, audioData }) => {
			const cached = previous.get(source.id);
			const offsetMs = source.timelineOffsetMs;
			const entry =
				cached?.original === audioData && cached.offsetMs === offsetMs && cached.durationMs === durationMs
					? cached
					: {
							original: audioData,
							offsetMs,
							durationMs,
							audioData: placeAudioOnTimeline(audioData, offsetMs, durationMs),
						};

			next.set(source.id, entry);

			return { source, audioData: entry.audioData };
		});

		cacheRef.current = next;

		return resolved;
	}, [rawSources, durationMs]);

	return { renderableSources, chromeAudio: renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA, layerColor };
}
