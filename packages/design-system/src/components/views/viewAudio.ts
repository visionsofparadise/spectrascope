import type { Source } from "../../source";
import type { AudioData } from "../spectral/types";

/**
 * Shared helper for the per-source / chart views after the per-source-audio
 * change (workspace-shell desktop migration, Phase 3.4).
 *
 * Each view holds a `sourceId → AudioData` map and renders one strip / trace
 * per source. A source is only renderable when it has an entry in the map
 * (audio still decoding, or an import failed, leaves a source absent). The
 * view's *shared chrome* — the `TimeRuler`, `FrequencyMinimap`,
 * `MinimapDisplay`, and the derived `durationSec` — still needs a single
 * `AudioData` to size against; it uses the first renderable source's audio.
 *
 * `EMPTY_AUDIO_DATA` is the zero-duration fallback the chrome falls back to
 * when no source is renderable; the views render their existing empty-state
 * message in that case, so the fallback is only ever sizing inert chrome.
 */

/** A zero-duration, zero-sample `AudioData` — chrome fallback for an empty view. */
export const EMPTY_AUDIO_DATA: AudioData = {
	sampleRate: 48000,
	channels: 1,
	totalSamples: 0,
	durationMs: 0,
	readSamples: () => Promise.resolve(new Float32Array(0)),
};

/** A source paired with its resolved `AudioData`. */
export interface SourceWithAudio {
	readonly source: Source;
	readonly audioData: AudioData;
}

/**
 * Resolve the visible sources that have decoded audio, in source order. A
 * source that is visible but missing from `sourceAudio` is skipped — it has
 * no buffer to render yet.
 */
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
