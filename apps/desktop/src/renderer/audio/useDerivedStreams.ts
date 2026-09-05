import { useEffect, useMemo, useRef, useState } from "react";
import { main } from "../models/Main";
import { createStreamAudioData } from "./streamAudioData";
import type { StreamInput, StreamSpec } from "../../main/audio/streamDsp";
import type { PreparedSource } from "../../main/SourceCacheManager";
import type { StreamInfo } from "../../main/StreamManager";
import type { Source } from "../workspace/source";
import type { AudioData } from "../workspace/spectral/types";

const EMPTY_DERIVED_AUDIO: AudioData = {
	sampleRate: 48000,
	channels: 1,
	totalSamples: 0,
	durationMs: 0,
	readSamples: () => Promise.resolve(new Float32Array(0)),
};

export interface UseDerivedStreamsResult {
	readonly sumAudio: AudioData;
	readonly diffAudio: AudioData;
	readonly sumInfo: StreamInfo | null;
	readonly diffInfo: StreamInfo | null;
}

interface DerivedEntry {
	readonly info: StreamInfo;
	readonly audioData: AudioData;
}

export function resolveAudibleSources(sources: ReadonlyArray<Source>): ReadonlyArray<Source> {
	const anySoloed = sources.some((source) => source.soloed);

	if (anySoloed) {
		return sources.filter((source) => source.soloed);
	}

	return sources.filter((source) => !source.muted);
}

function specKey(role: string, inputs: ReadonlyArray<StreamInput>): string {
	return `${role}|${inputs.map((input) => `${input.pcmPath}@${String(input.offsetMs)}:${String(input.gain)}`).join("|")}`;
}

function useRegisteredDerivedStream(
	cacheRef: React.RefObject<Map<string, DerivedEntry>>,
	setVersion: React.Dispatch<React.SetStateAction<number>>,
	key: string | null,
	inputs: ReadonlyArray<StreamInput> | null,
): void {
	useEffect(() => {
		if (key === null || inputs === null) return;

		const cache = cacheRef.current;

		if (cache.has(key)) return;

		let cancelled = false;

		void main
			.registerStream({ inputs } satisfies StreamSpec)
			.then((info) => {
				cache.set(key, { info, audioData: createStreamAudioData(info) });
			})
			.catch(() => undefined)
			.finally(() => {
				if (!cancelled) setVersion((current) => current + 1);
			});

		return () => {
			cancelled = true;
		};
	}, [cacheRef, setVersion, key, inputs]);
}

export function useDerivedStreams(
	sources: ReadonlyArray<Source>,
	prepared: ReadonlyMap<string, PreparedSource>,
	differenceA: string | null,
	differenceB: string | null,
	onDefaultDifference: (a: string, b: string) => void,
): UseDerivedStreamsResult {
	const cacheRef = useRef(new Map<string, DerivedEntry>());
	const [version, setVersion] = useState(0);

	const onDefaultDifferenceRef = useRef(onDefaultDifference);

	useEffect(() => {
		onDefaultDifferenceRef.current = onDefaultDifference;
	}, [onDefaultDifference]);

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

	useEffect(() => {
		if (differenceA !== null || differenceB !== null) return;

		if (sources.length < 2) return;

		const first = sources[0];
		const second = sources[1];

		if (!first || !second) return;

		onDefaultDifferenceRef.current(first.id, second.id);
	}, [differenceA, differenceB, sources]);

	useRegisteredDerivedStream(cacheRef, setVersion, sumKey, sumInputs);
	useRegisteredDerivedStream(cacheRef, setVersion, diffKey, diffInputs);

	return useMemo<UseDerivedStreamsResult>(() => {
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
