import { useEffect, useMemo, useRef, useState } from "react";
import { main } from "../models/Main";
import { createStreamAudioData } from "./streamAudioData";
import type { PreparedSource } from "../../main/SourceCacheManager";
import type { Source } from "../workspace/source";
import type { AudioData } from "../workspace/spectral/types";

export type SourceStreamStatus = "preparing" | "ready" | "error";

export interface UseSourceStreamsResult {
	/**
	 * Stream-backed PCM readers keyed by `Source.id`. A source is present only
	 * once its file has been prepared and its display stream registered; a
	 * preparing or failed source is absent, and the views skip it.
	 */
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	/**
	 * The `PreparedSource` (canonical `pcmPath`, sample rate, channel/sample
	 * counts, native rate) keyed by `Source.id` — the input `useDerivedStreams`
	 * folds into the sum / diff specs. Present only for a `ready` source.
	 */
	readonly prepared: ReadonlyMap<string, PreparedSource>;
	readonly status: ReadonlyMap<string, SourceStreamStatus>;
}

interface PathCacheEntry {
	readonly status: SourceStreamStatus;
	readonly audioData?: AudioData;
	readonly prepared?: PreparedSource;
}

const EMPTY_RESULT: UseSourceStreamsResult = {
	sourceAudio: new Map<string, AudioData>(),
	prepared: new Map<string, PreparedSource>(),
	status: new Map<string, SourceStreamStatus>(),
};

function cacheKey(path: string, rate: number | null): string {
	return `${path}@${rate === null ? "native" : String(rate)}`;
}

export function useSourceStreams(
	sources: ReadonlyArray<Source>,
	canonicalSampleRate: number | null,
	onCaptureRate: (nativeSampleRate: number) => void,
): UseSourceStreamsResult {
	const cacheRef = useRef(new Map<string, PathCacheEntry>());
	const [version, setVersion] = useState(0);

	const onCaptureRateRef = useRef(onCaptureRate);

	useEffect(() => {
		onCaptureRateRef.current = onCaptureRate;
	}, [onCaptureRate]);

	const captureFiredRef = useRef(false);

	const filePaths = useMemo(() => {
		const set = new Set<string>();

		for (const source of sources) {
			if (source.audioFilePath.length > 0) {
				set.add(source.audioFilePath);
			}
		}

		return [...set];
	}, [sources]);

	useEffect(() => {
		let cancelled = false;
		const cache = cacheRef.current;

		for (const filePath of filePaths) {
			const key = cacheKey(filePath, canonicalSampleRate);

			if (cache.has(key)) continue;

			cache.set(key, { status: "preparing" });

			void main
				.prepareSource(filePath, canonicalSampleRate)
				.then(async (prepared) => {
					const info = await main.registerStream({
						inputs: [{ pcmPath: prepared.pcmPath, offsetMs: 0, gain: 1 }],
					});

					cache.set(key, { status: "ready", prepared, audioData: createStreamAudioData(info) });
				})
				.catch(() => {
					cache.set(key, { status: "error" });
				})
				.finally(() => {
					if (!cancelled) {
						setVersion((current) => current + 1);
					}
				});
		}

		return () => {
			cancelled = true;
		};
	}, [filePaths, canonicalSampleRate]);

	useEffect(() => {
		if (canonicalSampleRate !== null) {
			captureFiredRef.current = false;

			return;
		}

		if (captureFiredRef.current) return;

		const first = sources.find((source) => source.audioFilePath.length > 0);

		if (!first) return;

		const entry = cacheRef.current.get(cacheKey(first.audioFilePath, null));

		if (entry?.status === "ready" && entry.prepared) {
			captureFiredRef.current = true;
			onCaptureRateRef.current(entry.prepared.nativeSampleRate);
		}
	}, [version, canonicalSampleRate, sources]);

	return useMemo<UseSourceStreamsResult>(() => {
		void version;

		if (sources.length === 0) return EMPTY_RESULT;

		const cache = cacheRef.current;
		const sourceAudio = new Map<string, AudioData>();
		const prepared = new Map<string, PreparedSource>();
		const status = new Map<string, SourceStreamStatus>();

		for (const source of sources) {
			if (source.audioFilePath.length === 0) {
				status.set(source.id, "error");

				continue;
			}

			const entry = cache.get(cacheKey(source.audioFilePath, canonicalSampleRate));

			if (!entry) {
				status.set(source.id, "preparing");

				continue;
			}

			status.set(source.id, entry.status);

			if (entry.status === "ready" && entry.audioData && entry.prepared) {
				sourceAudio.set(source.id, entry.audioData);
				prepared.set(source.id, entry.prepared);
			}
		}

		return { sourceAudio, prepared, status };
	}, [sources, canonicalSampleRate, version]);
}
