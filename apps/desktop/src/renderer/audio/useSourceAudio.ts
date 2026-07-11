import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioData } from "../workspace/spectral/types";
import type { Source } from "../workspace/source";
import { decodeAudio } from "./decodeAudio";

/** Per-source decode status — `loading` until the file decodes, then `ready` or `error`. */
export type SourceAudioStatus = "loading" | "ready" | "error";

export interface UseSourceAudioResult {
	/**
	 * Decoded PCM keyed by `Source.id`. A source is present only once its file
	 * has decoded successfully; a still-decoding or failed source is absent, and
	 * the workspace views skip an absent source.
	 */
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	/**
	 * Raw decoded `AudioBuffer`s keyed by `Source.id` — the same set of sources
	 * as `sourceAudio`, retained for the live `MixPlayer` so per-source playback
	 * does not re-decode the file. Present only for a `ready` source.
	 */
	readonly sourceBuffers: ReadonlyMap<string, AudioBuffer>;
	/** Decode status keyed by `Source.id` — `loading` while decoding, then `ready` / `error`. */
	readonly status: ReadonlyMap<string, SourceAudioStatus>;
}

/** Internal cache entry for one decoded file path. */
interface PathCacheEntry {
	readonly status: SourceAudioStatus;
	readonly audioData?: AudioData;
	readonly audioBuffer?: AudioBuffer;
}

const EMPTY_RESULT: UseSourceAudioResult = {
	sourceAudio: new Map<string, AudioData>(),
	sourceBuffers: new Map<string, AudioBuffer>(),
	status: new Map<string, SourceAudioStatus>(),
};

/**
 * Resolve per-source decoded audio for a comparison's sources.
 *
 * Each distinct `audioFilePath` is decoded once via `decodeAudio` and cached by
 * path for the lifetime of the hook — two sources pointing at the same file
 * share one decoded buffer, and adding/removing sources never re-decodes a path
 * already in the cache. Decoding is asynchronous: a source is absent from
 * `sourceAudio` until its file resolves, and the views render their empty state
 * (or skip the strip) for an absent source. A failed decode is recorded as an
 * `error` status and the source stays absent from `sourceAudio`.
 *
 * Both the display `AudioData` and the raw `AudioBuffer` are kept per source —
 * the views consume `sourceAudio`, the live `MixPlayer` consumes
 * `sourceBuffers`, and neither re-decodes the file.
 *
 * The returned maps are rebuilt only when the decode results actually change —
 * a re-render with the same sources and the same cache returns the same map
 * contents, so the controlled workspace components do not see spurious prop
 * churn.
 */
export function useSourceAudio(sources: ReadonlyArray<Source>): UseSourceAudioResult {
	// Decoded-audio cache, keyed by absolute file path. A ref (not state) so the
	// cache survives re-renders; a monotonically-bumped `version` triggers the
	// render when an async decode lands.
	const cacheRef = useRef(new Map<string, PathCacheEntry>());
	const [version, setVersion] = useState(0);

	// The distinct, non-empty file paths the current sources reference. A source
	// with no file path yet (a freshly added, file-less source) contributes no
	// path and stays absent from the audio map.
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
			if (cache.has(filePath)) continue;

			// Mark loading immediately so a re-render before the decode resolves
			// reports `loading` rather than re-dispatching the decode.
			cache.set(filePath, { status: "loading" });

			void decodeAudio(filePath)
				.then((decoded) => {
					cache.set(filePath, {
						status: "ready",
						audioData: decoded.audioData,
						audioBuffer: decoded.audioBuffer,
					});
				})
				.catch(() => {
					cache.set(filePath, { status: "error" });
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
	}, [filePaths]);

	return useMemo<UseSourceAudioResult>(() => {
		// `version` is read so the memo recomputes when a decode lands; the cache
		// is a ref, so without this the memo would not see the new entries.
		void version;

		if (sources.length === 0) return EMPTY_RESULT;

		const cache = cacheRef.current;
		const sourceAudio = new Map<string, AudioData>();
		const sourceBuffers = new Map<string, AudioBuffer>();
		const status = new Map<string, SourceAudioStatus>();

		for (const source of sources) {
			if (source.audioFilePath.length === 0) {
				// A file-less source has nothing to decode — surface it as an error
				// so a caller can distinguish it from a still-decoding source.
				status.set(source.id, "error");
				continue;
			}

			const entry = cache.get(source.audioFilePath);

			if (!entry) {
				status.set(source.id, "loading");
				continue;
			}

			status.set(source.id, entry.status);

			if (entry.status === "ready" && entry.audioData && entry.audioBuffer) {
				sourceAudio.set(source.id, entry.audioData);
				sourceBuffers.set(source.id, entry.audioBuffer);
			}
		}

		return { sourceAudio, sourceBuffers, status };
	}, [sources, version]);
}
