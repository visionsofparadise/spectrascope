import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { initializeStreamQueries, sourceStreamQueryOptions, type StreamQueryEntry } from "./utils/streamQueryOptions";
import type { PreparedSource } from "../../main/SourceCacheManager";
import type { Source } from "../workspace/source";
import type { AudioData } from "../workspace/spectral/types";

export type SourceStreamStatus = "preparing" | "ready" | "error";

export interface UseSourceStreamsResult {
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly prepared: ReadonlyMap<string, PreparedSource>;
	readonly status: ReadonlyMap<string, SourceStreamStatus>;
	readonly errors: ReadonlyMap<string, string>;
	readonly retrySource: (sourceId: string) => void;
}

function combineSourceResults(results: Array<UseQueryResult<StreamQueryEntry>>) {
	return results.map((result) => ({ data: result.data, error: result.error }));
}

export function useSourceStreams(
	sources: ReadonlyArray<Source>,
	canonicalSampleRate: number | null,
	onCaptureRate: (nativeSampleRate: number) => void,
): UseSourceStreamsResult {
	const client = useQueryClient();

	initializeStreamQueries(client);

	const filePaths = useMemo(
		() => [...new Set(sources.map((source) => source.audioFilePath).filter(Boolean))],
		[sources],
	);
	const results = useQueries({
		queries: filePaths.map((filePath) => sourceStreamQueryOptions(filePath, canonicalSampleRate)),
		combine: combineSourceResults,
	});
	const firstPrepared = results[0]?.data?.prepared;
	const captureFired = useRef(false);

	useEffect(() => {
		if (canonicalSampleRate !== null) {
			captureFired.current = false;

			return;
		}

		if (!captureFired.current && firstPrepared) {
			captureFired.current = true;
			onCaptureRate(firstPrepared.nativeSampleRate);
		}
	}, [canonicalSampleRate, firstPrepared, onCaptureRate]);

	const retrySource = useCallback(
		(sourceId: string): void => {
			const source = sources.find((candidate) => candidate.id === sourceId);

			if (!source?.audioFilePath) return;

			void client.resetQueries({
				queryKey: sourceStreamQueryOptions(source.audioFilePath, canonicalSampleRate).queryKey,
				exact: true,
			});
		},
		[sources, canonicalSampleRate, client],
	);

	return useMemo(() => {
		const sourceAudio = new Map<string, AudioData>();
		const prepared = new Map<string, PreparedSource>();
		const status = new Map<string, SourceStreamStatus>();
		const errors = new Map<string, string>();

		for (const source of sources) {
			const result = results[filePaths.indexOf(source.audioFilePath)];

			if (!result) {
				status.set(source.id, "error");
				errors.set(source.id, "Choose an audio file for this source.");
			} else if (result.error) {
				status.set(source.id, "error");
				errors.set(source.id, result.error.message);
			} else if (result.data?.prepared) {
				status.set(source.id, "ready");
				sourceAudio.set(source.id, result.data.audioData);
				prepared.set(source.id, result.data.prepared);
			} else status.set(source.id, "preparing");
		}

		return { sourceAudio, prepared, status, errors, retrySource };
	}, [sources, filePaths, results, retrySource]);
}
