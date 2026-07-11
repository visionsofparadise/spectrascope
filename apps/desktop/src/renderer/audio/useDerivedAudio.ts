import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioData } from "../workspace/spectral/types";
import type { Source } from "../workspace/source";
import type { RenderOperation, RenderSpec } from "../../main/ffmpeg/renderSpec";
import { main } from "../models/Main";
import { decodeAudio } from "./decodeAudio";

/**
 * Status of a derived (Sum / Difference) render.
 *
 * - `rendering` — an ffmpeg render is in flight (or its result is decoding).
 * - `ready` — `audioData` holds the decoded derived signal.
 * - `empty` — there is nothing to render: no audible sources, or a Difference
 *   with fewer than two audible sources (a Difference needs a reference *and*
 *   at least one other source — see the "Difference is reference-minus-the-rest"
 *   design decision).
 */
export type DerivedAudioStatus = "rendering" | "ready" | "empty";

export interface UseDerivedAudioResult {
	readonly status: DerivedAudioStatus;
	/** The decoded derived signal — present only when `status` is `ready`. */
	readonly audioData?: AudioData;
	/**
	 * Absolute path of the ffmpeg-rendered derived WAV — present only when
	 * `status` is `ready`. The Sum / Difference views audition this temp file
	 * directly through a `PlaybackEngine` (the same artifact they display).
	 */
	readonly filePath?: string;
}

/** Result returned without dispatching a render — the comparison has nothing audible to derive. */
const EMPTY_RESULT: UseDerivedAudioResult = { status: "empty" };

/**
 * Resolve the audible source set for a render.
 *
 * Solo overrides mute: if any source is soloed, only the soloed sources are
 * audible; otherwise every non-muted source is audible. `visible` is a
 * display-only flag and deliberately does **not** affect the render — the
 * derived signal reflects what is audible, not what is shown.
 */
function resolveAudibleSources(sources: ReadonlyArray<Source>): ReadonlyArray<Source> {
	const anySoloed = sources.some((source) => source.soloed);

	if (anySoloed) {
		return sources.filter((source) => source.soloed);
	}

	return sources.filter((source) => !source.muted);
}

/**
 * Build the `RenderSpec` for a derived render, or `null` when the operation is
 * not defined for the current audible set.
 *
 * A `sum` needs at least one audible source. A `difference` needs at least two
 * (a reference plus the rest); with fewer it is undefined and the view shows
 * its empty state. The reference is always the first audible source in list
 * order, so `referenceIndex` is `0` for a difference and irrelevant (`0`) for a
 * sum. A source with no `audioFilePath` yet has nothing for ffmpeg to read and
 * is dropped from the inputs.
 */
function buildRenderSpec(sources: ReadonlyArray<Source>, operation: RenderOperation): RenderSpec | null {
	const audible = resolveAudibleSources(sources).filter((source) => source.audioFilePath.length > 0);

	const minimumInputs = operation === "difference" ? 2 : 1;

	if (audible.length < minimumInputs) {
		return null;
	}

	return {
		operation,
		inputs: audible.map((source) => ({
			filePath: source.audioFilePath,
			offsetMs: Math.max(0, source.timelineOffsetMs),
		})),
		referenceIndex: 0,
	};
}

/**
 * Stable string key for a `RenderSpec` — the renderer-side mirror of the
 * `RenderManager`'s hash, minus the file content identity (path + size + mtime,
 * which the main process resolves). Two renders with the same operation, the
 * same ordered inputs (path + offset) and the same reference produce the same
 * key, so the hook re-dispatches a render only when the spec genuinely changes.
 */
function specKey(spec: RenderSpec): string {
	const inputs = spec.inputs.map((input) => `${input.filePath}@${String(input.offsetMs)}`).join("|");

	return `${spec.operation}:ref${String(spec.referenceIndex)}:${inputs}`;
}

/**
 * Resolve the ffmpeg-rendered derived audio for a comparison's active derived
 * view.
 *
 * Given the comparison's `sources` and the `operation` (`sum` | `difference`,
 * or `null` when no derived view is active), the hook resolves the audible set
 * (solo overrides mute), builds a `RenderSpec`, calls the
 * `Render/renderDerived` IPC — which spawns ffmpeg in the main process and
 * resolves with a temp WAV path — and decodes that WAV into the design-system
 * `AudioData` shape with `decodeAudio`. The two derived views consume the
 * result through their `derivedAudio` prop, exactly as a source view consumes a
 * per-source `AudioData`.
 *
 * Passing `operation: null` (the active view is not a derived view) makes the
 * hook a no-op — it returns `empty` and dispatches no render — so the hook can
 * be called unconditionally (React's rules of hooks) without spawning ffmpeg
 * for a view that does not display a derived signal.
 *
 * The render is gated on a memoized spec key: the call re-dispatches only when
 * the operation, the ordered audible inputs, or their offsets change (adding /
 * removing a source, toggling mute/solo, moving a source on the timeline). The
 * `RenderManager` is itself hash-keyed and caches by content identity, so a
 * re-dispatch whose output already exists returns immediately; this hook's key
 * just avoids a redundant IPC round-trip and decode.
 */
export function useDerivedAudio(sources: ReadonlyArray<Source>, operation: RenderOperation | null): UseDerivedAudioResult {
	// The render spec for the current audible set, or `null` when no derived
	// view is active or the operation has nothing to render (its view shows an
	// empty state).
	const spec = useMemo(() => (operation === null ? null : buildRenderSpec(sources, operation)), [sources, operation]);

	// The stable key the render dispatch is gated on — `null` mirrors `spec`.
	const key = useMemo(() => (spec === null ? null : specKey(spec)), [spec]);

	const [result, setResult] = useState<UseDerivedAudioResult>(EMPTY_RESULT);

	// The key the current `result` was produced for. A ref (not state) so a
	// re-render mid-render does not re-dispatch; only a genuine key change does.
	const resolvedKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (spec === null || key === null) {
			resolvedKeyRef.current = null;
			setResult(EMPTY_RESULT);

			return;
		}

		// `spec`/`key` are recomputed on every `sources` change; bail when the key
		// is unchanged so an unrelated re-render does not re-dispatch the render.
		if (resolvedKeyRef.current === key) {
			return;
		}

		resolvedKeyRef.current = key;

		let cancelled = false;

		setResult({ status: "rendering" });

		void main
			.renderDerived(spec)
			.then((resultPath) =>
				decodeAudio(resultPath).then((decoded) => ({ resultPath, decoded })),
			)
			.then(({ resultPath, decoded }) => {
				if (cancelled) return;

				setResult({ status: "ready", audioData: decoded.audioData, filePath: resultPath });
			})
			.catch(() => {
				if (cancelled) return;

				// A failed render leaves the view with no derived signal. Surface it
				// as `empty` — the view falls back to its empty / "no audio" state
				// rather than a stale buffer.
				resolvedKeyRef.current = null;
				setResult(EMPTY_RESULT);
			});

		return () => {
			cancelled = true;
		};
	}, [spec, key]);

	return result;
}
