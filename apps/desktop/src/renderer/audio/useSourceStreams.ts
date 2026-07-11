import { useEffect, useMemo, useRef, useState } from "react";
import type { PreparedSource } from "../../main/SourceCacheManager";
import { main } from "../models/Main";
import type { AudioData } from "../workspace/spectral/types";
import type { Source } from "../workspace/source";
import { createStreamAudioData } from "./streamAudioData";

/** Per-source stream-preparation status — `preparing` until the stream registers, then `ready` or `error`. */
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
	/** Preparation status keyed by `Source.id` — `preparing` while in flight, then `ready` / `error`. */
	readonly status: ReadonlyMap<string, SourceStreamStatus>;
}

/** Internal cache entry for one prepared `(path, rate)` pair. */
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

/**
 * Cache key for a prepared source. Keyed by `(path, rate)` so a canonical-rate
 * change re-prepares every source (the main-process cache makes a re-prepare at
 * a rate already transcoded a cheap hit). `null` rate — the pre-capture state —
 * prepares at each file's native rate.
 */
function cacheKey(path: string, rate: number | null): string {
	return `${path}@${rate === null ? "native" : String(rate)}`;
}

/**
 * Resolve per-source stream-backed audio for a comparison's sources.
 *
 * Each distinct `(audioFilePath, canonicalSampleRate)` pair is prepared once via
 * `main.prepareSource` (import-time canonicalization in the main process) and its
 * single-input display stream registered via `main.registerStream` (offset-free
 * at `offsetMs: 0` — offset placement is a Timeline-layout concern of the derived
 * streams, not per-source display). The registered `StreamInfo` becomes an
 * `AudioData` whose `readSamples` Range-fetches the raw flavor. Results are
 * cached by key for the hook's lifetime, so adding/removing sources or a repeat
 * rate never re-prepares a pair already resolved.
 *
 * Capture: when `canonicalSampleRate` is `null` and the first source's file
 * resolves, `onCaptureRate` is called with its native rate — the host writes it
 * into the comparison as the sticky default. That write is an ordinary
 * history-participating edit; undoing it back to `null` simply re-triggers the
 * capture.
 */
export function useSourceStreams(
	sources: ReadonlyArray<Source>,
	canonicalSampleRate: number | null,
	onCaptureRate: (nativeSampleRate: number) => void,
): UseSourceStreamsResult {
	// Prepared-stream cache, keyed by `(path, rate)`. A ref (not state) so the
	// cache survives re-renders; a monotonically-bumped `version` triggers the
	// render when an async prepare/register lands.
	const cacheRef = useRef(new Map<string, PathCacheEntry>());
	const [version, setVersion] = useState(0);

	// Keep the capture callback in a ref so the capture effect does not re-run
	// (and re-fire the capture) merely because the host passed a fresh closure.
	const onCaptureRateRef = useRef(onCaptureRate);

	useEffect(() => {
		onCaptureRateRef.current = onCaptureRate;
	}, [onCaptureRate]);

	// Whether the null-rate capture has already fired for the current null
	// window. Reset whenever a concrete rate is present, so an undo back to
	// `null` re-arms the capture.
	const captureFiredRef = useRef(false);

	// The distinct, non-empty file paths the current sources reference.
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

			// Mark preparing immediately so a re-render before the async work
			// resolves reports `preparing` rather than re-dispatching it.
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

	// Capture the sticky default rate from the first source once it resolves,
	// while no canonical rate is set. Runs after each prepare lands (`version`).
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
		// `version` is read so the memo recomputes when an async prepare lands;
		// the cache is a ref, so without this the memo would not see new entries.
		void version;

		if (sources.length === 0) return EMPTY_RESULT;

		const cache = cacheRef.current;
		const sourceAudio = new Map<string, AudioData>();
		const prepared = new Map<string, PreparedSource>();
		const status = new Map<string, SourceStreamStatus>();

		for (const source of sources) {
			if (source.audioFilePath.length === 0) {
				// A file-less source has nothing to prepare — surface it as an error
				// so a caller can distinguish it from a still-preparing source.
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
