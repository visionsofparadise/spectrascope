import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	derivedStreamQueryOptions,
	initializeStreamQueries,
	retainStreamQuery,
	type StreamQueryEntry,
} from "./utils/streamQueryOptions";
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
	readonly preparing: boolean;
	readonly error: string | null;
	readonly retry: () => void;
}

export function resolveAudibleSources(sources: ReadonlyArray<Source>): ReadonlyArray<Source> {
	const anySoloed = sources.some((source) => source.soloed);

	if (anySoloed) {
		return sources.filter((source) => source.soloed);
	}

	return sources.filter((source) => !source.muted);
}

function useRegisteredDerivedStream(spec: StreamSpec | null) {
	const result = useQuery({ ...derivedStreamQueryOptions(spec), placeholderData: keepPreviousData });
	const held = useRef<StreamQueryEntry | null>(null);
	const entry = spec === null ? null : (result.data ?? held.current);

	const { refetch } = result;

	useEffect(() => {
		const release = entry ? retainStreamQuery(entry) : null;

		held.current = release ? entry : null;

		if (entry && !release) void refetch();

		return release ?? undefined;
	}, [entry, refetch]);

	return { result, entry, preparing: spec !== null && result.isFetching };
}

export function useDerivedStreams(
	sources: ReadonlyArray<Source>,
	prepared: ReadonlyMap<string, PreparedSource>,
	differenceA: string | null,
	differenceB: string | null,
	onDefaultDifference: (a: string, b: string) => void,
): UseDerivedStreamsResult {
	const client = useQueryClient();

	initializeStreamQueries(client);

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

	const sumSpec = useMemo(() => (sumInputs.length === 0 ? null : { inputs: sumInputs }), [sumInputs]);

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

	const diffSpec = useMemo(() => (diffInputs === null ? null : { inputs: diffInputs }), [diffInputs]);

	useEffect(() => {
		if (differenceA !== null || differenceB !== null) return;

		if (sources.length < 2) return;

		const first = sources[0];
		const second = sources[1];

		if (!first || !second) return;

		onDefaultDifferenceRef.current(first.id, second.id);
	}, [differenceA, differenceB, sources]);

	const sum = useRegisteredDerivedStream(sumSpec);
	const difference = useRegisteredDerivedStream(diffSpec);
	const retry = useCallback((): void => {
		void client.invalidateQueries({ queryKey: ["derived-stream"] });
	}, [client]);

	return {
		sumAudio: sum.entry?.audioData ?? EMPTY_DERIVED_AUDIO,
		diffAudio: difference.entry?.audioData ?? EMPTY_DERIVED_AUDIO,
		sumInfo: sum.entry?.info ?? null,
		diffInfo: difference.entry?.info ?? null,
		preparing: sum.preparing || difference.preparing,
		error: sum.result.error?.message ?? difference.result.error?.message ?? null,
		retry,
	};
}
