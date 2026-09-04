import { useEffect, useMemo, useRef, useState } from "react";
import { main } from "../models/Main";
import { createStreamAudioData } from "./streamAudioData";
import type { StreamInput, StreamSpec } from "../../main/audio/streamDsp";
import type { PreparedSource } from "../../main/SourceCacheManager";
import type { StreamInfo } from "../../main/StreamManager";
import type { Source } from "../workspace/source";
import type { AudioData } from "../workspace/spectral/types";

/**
 * Zero-duration `AudioData` routed into a derived (Sum / Difference) view whose
 * stream has nothing to render or has not registered yet. The view renders its
 * built-in empty state against this reader while the host paints its overlay.
 */
export const EMPTY_DERIVED_AUDIO: AudioData = {
	sampleRate: 48000,
	channels: 1,
	totalSamples: 0,
	durationMs: 0,
	readSamples: () => Promise.resolve(new Float32Array(0)),
};

export interface UseDerivedStreamsResult {
	/** The sum-of-audible stream as an `AudioData`, or `EMPTY_DERIVED_AUDIO` when there is nothing audible. */
	readonly sumAudio: AudioData;
	/** The A−B difference stream as an `AudioData`, or `EMPTY_DERIVED_AUDIO` when A/B are not both resolvable. */
	readonly diffAudio: AudioData;
	/** Registered sum-stream metadata (Phase 5.1 builds the playback URL from `sumInfo.key`), or `null`. */
	readonly sumInfo: StreamInfo | null;
	/** Registered diff-stream metadata (Phase 5.1 builds the playback URL from `diffInfo.key`), or `null`. */
	readonly diffInfo: StreamInfo | null;
}

interface DerivedEntry {
	readonly info: StreamInfo;
	readonly audioData: AudioData;
}

/**
 * Resolve the audible source set — solo overrides mute (`visible` is
 * display-only and deliberately does not affect the audible/derived signal).
 * Shared by the Sum spec here and the host's empty-state overlay.
 */
export function resolveAudibleSources(sources: ReadonlyArray<Source>): ReadonlyArray<Source> {
	const anySoloed = sources.some((source) => source.soloed);

	if (anySoloed) {
		return sources.filter((source) => source.soloed);
	}

	return sources.filter((source) => !source.muted);
}

/** Stable key for a stream spec — the ordered inputs (pcmPath, offset, gain), prefixed by role. */
function specKey(role: string, inputs: ReadonlyArray<StreamInput>): string {
	return `${role}|${inputs.map((input) => `${input.pcmPath}@${String(input.offsetMs)}:${String(input.gain)}`).join("|")}`;
}

/**
 * Resolve the Sum and Difference derived streams for a comparison.
 *
 * The Sum spec is the solo-resolved audible set, each input placed at its
 * `timelineOffsetMs` with gain `+1`. The Difference spec is `[A gain +1, B gain
 * −1]` from `differenceA`/`differenceB` (source ids), defaulting to the first
 * two sources when null — the defaults are written back into the comparison
 * once two sources exist (a history-participating `difference` edit; undo to
 * null is harmless). Each spec's inputs resolve their canonical `pcmPath` from
 * `prepared` (4.2), so a source not yet prepared is dropped from the spec.
 *
 * Both specs are registered as streams (re-registered on any parameter change,
 * gated on a stable spec key so an unrelated re-render does not re-register).
 * The result exposes each as an `AudioData` plus its `StreamInfo` (Phase 5.1
 * needs the keys to build playback URLs), with `EMPTY_DERIVED_AUDIO` / `null`
 * fallbacks while a spec is empty or in flight.
 */
export function useDerivedStreams(
	sources: ReadonlyArray<Source>,
	prepared: ReadonlyMap<string, PreparedSource>,
	differenceA: string | null,
	differenceB: string | null,
	onDefaultDifference: (a: string, b: string) => void,
): UseDerivedStreamsResult {
	// Registered-stream cache keyed by spec key; a ref so it survives re-renders,
	// with a bumped `version` to re-render when an async registration lands.
	const cacheRef = useRef(new Map<string, DerivedEntry>());
	const [version, setVersion] = useState(0);

	const onDefaultDifferenceRef = useRef(onDefaultDifference);

	useEffect(() => {
		onDefaultDifferenceRef.current = onDefaultDifference;
	}, [onDefaultDifference]);

	// --- Sum spec: the audible set, each input at its timeline offset ---------
	const sumInputs = useMemo<ReadonlyArray<StreamInput>>(() => {
		const inputs: Array<StreamInput> = [];

		for (const source of resolveAudibleSources(sources)) {
			const preparedSource = prepared.get(source.id);

			if (!preparedSource) continue;

			inputs.push({ pcmPath: preparedSource.pcmPath, offsetMs: Math.max(0, source.timelineOffsetMs), gain: 1 });
		}

		return inputs;
	}, [sources, prepared]);

	const sumKey = useMemo(() => (sumInputs.length === 0 ? null : specKey("sum", sumInputs)), [sumInputs]);

	// --- Difference spec: [A gain +1, B gain −1], defaulting to first two ------
	// A stored id that no longer resolves to a live source (its source was
	// removed) falls back to the default the same as null, so the rendered diff
	// tracks what the A/B selectors display rather than emptying until reselect.
	const effectiveA =
		differenceA !== null && sources.some((source) => source.id === differenceA)
			? differenceA
			: (sources[0]?.id ?? null);
	const effectiveB =
		differenceB !== null && sources.some((source) => source.id === differenceB)
			? differenceB
			: (sources[1]?.id ?? null);

	const diffInputs = useMemo<ReadonlyArray<StreamInput> | null>(() => {
		if (effectiveA === null || effectiveB === null) return null;

		const sourceA = sources.find((source) => source.id === effectiveA);
		const sourceB = sources.find((source) => source.id === effectiveB);

		if (!sourceA || !sourceB) return null;

		const preparedA = prepared.get(sourceA.id);
		const preparedB = prepared.get(sourceB.id);

		if (!preparedA || !preparedB) return null;

		return [
			{ pcmPath: preparedA.pcmPath, offsetMs: Math.max(0, sourceA.timelineOffsetMs), gain: 1 },
			{ pcmPath: preparedB.pcmPath, offsetMs: Math.max(0, sourceB.timelineOffsetMs), gain: -1 },
		];
	}, [sources, prepared, effectiveA, effectiveB]);

	const diffKey = useMemo(() => (diffInputs === null ? null : specKey("diff", diffInputs)), [diffInputs]);

	// Persist the sticky A/B default once two sources exist and neither field is
	// set. The write re-renders with both fields non-null, so the guard stops it
	// re-firing; an undo back to null re-triggers it (accepted per the design).
	useEffect(() => {
		if (differenceA !== null || differenceB !== null) return;

		if (sources.length < 2) return;

		const first = sources[0];
		const second = sources[1];

		if (!first || !second) return;

		onDefaultDifferenceRef.current(first.id, second.id);
	}, [differenceA, differenceB, sources]);

	// Register the sum stream when its spec key changes.
	useEffect(() => {
		if (sumKey === null) return;

		const cache = cacheRef.current;

		if (cache.has(sumKey)) return;

		let cancelled = false;

		void main
			.registerStream({ inputs: sumInputs } satisfies StreamSpec)
			.then((info) => {
				cache.set(sumKey, { info, audioData: createStreamAudioData(info) });
			})
			.catch(() => undefined)
			.finally(() => {
				if (!cancelled) setVersion((current) => current + 1);
			});

		return () => {
			cancelled = true;
		};
	}, [sumKey, sumInputs]);

	// Register the diff stream when its spec key changes.
	useEffect(() => {
		if (diffKey === null || diffInputs === null) return;

		const cache = cacheRef.current;

		if (cache.has(diffKey)) return;

		let cancelled = false;

		void main
			.registerStream({ inputs: diffInputs } satisfies StreamSpec)
			.then((info) => {
				cache.set(diffKey, { info, audioData: createStreamAudioData(info) });
			})
			.catch(() => undefined)
			.finally(() => {
				if (!cancelled) setVersion((current) => current + 1);
			});

		return () => {
			cancelled = true;
		};
	}, [diffKey, diffInputs]);

	return useMemo<UseDerivedStreamsResult>(() => {
		// Read so the memo recomputes when an async registration lands.
		void version;

		const cache = cacheRef.current;
		const sumEntry = sumKey === null ? undefined : cache.get(sumKey);
		const diffEntry = diffKey === null ? undefined : cache.get(diffKey);

		return {
			sumAudio: sumEntry?.audioData ?? EMPTY_DERIVED_AUDIO,
			diffAudio: diffEntry?.audioData ?? EMPTY_DERIVED_AUDIO,
			sumInfo: sumEntry?.info ?? null,
			diffInfo: diffEntry?.info ?? null,
		};
	}, [sumKey, diffKey, version]);
}
