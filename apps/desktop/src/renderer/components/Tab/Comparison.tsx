import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "valtio/vanilla";
import {
	AppShell,
	SourcesPanel,
	SyncProvider,
	Transport,
	Workspace,
} from "@spectrascope/design-system";
import type { AudioData, Source, SyncState, TransportControl, ViewId } from "@spectrascope/design-system";
import { main } from "../../models/Main";
import { AUDIO_FILE_EXTENSIONS, createSourceFromFile, isBareAddSource } from "../../comparison/createComparison";
import { useSourceAudio } from "../../audio/useSourceAudio";
import { useDerivedAudio } from "../../audio/useDerivedAudio";
import { usePlayer } from "../../audio/usePlayer";
import type { PlaybackKind } from "../../audio/usePlayer";
import type { RenderOperation } from "../../../main/ffmpeg/renderSpec";
import { useComparisonHistory } from "../../state/useComparisonHistory";
import type { AppContext } from "../../models/Context";
import type { Comparison, SourceState } from "../../models/State/App";

interface Props {
	readonly context: AppContext;
	/**
	 * The comparison this tab renders — a valtio snapshot resolved from the
	 * store (deeply readonly; the `SourcesPanel` mutates back through
	 * `appStore.mutate`).
	 */
	readonly comparison: Snapshot<Comparison>;
}

/**
 * Zero-duration `AudioData` routed into the derived (Sum / Difference) view
 * while its ffmpeg render is in flight or has nothing to render. The two
 * derived views always require a single `AudioData`; against this empty reader
 * they render their built-in empty / "no audio" state, and `Comparison.tsx`
 * paints a "Rendering…" / empty overlay on top (see `derivedOverlayMessage`).
 * When the render is `ready` the real decoded derived signal is routed instead.
 */
const EMPTY_DERIVED_AUDIO: AudioData = {
	sampleRate: 48000,
	channels: 1,
	totalSamples: 0,
	durationMs: 0,
	readSamples: () => Promise.resolve(new Float32Array(0)),
};

/**
 * Map a view id to the derived-render operation it consumes, or `null` for a
 * non-derived (per-source / chart) view. Only the Sum and Difference views show
 * an ffmpeg-rendered derived signal.
 */
function derivedOperationFor(view: ViewId): RenderOperation | null {
	if (view === "sum") return "sum";
	if (view === "difference") return "difference";

	return null;
}

/**
 * Map a view id to its playback path (the design's "playback splits" decision):
 *
 * - `file` — Sum / Difference audition the ffmpeg-rendered temp file via a
 *   `PlaybackEngine`.
 * - `none` — Frequency Distribution and Vectorscope are whole-clip aggregates
 *   with no time evolution, so they have no playback (each publishes a
 *   `disabled` transport and the shell omits the transport row).
 * - `mix` — every other view (Overlay, Timeline, Slider, Loudness,
 *   Correlation) auditions a live `MixPlayer` over the audible sources.
 */
function playbackKindFor(view: ViewId): PlaybackKind {
	if (view === "sum" || view === "difference") return "file";
	if (view === "frequency-distribution" || view === "vectorscope") return "none";

	return "mix";
}

/**
 * The initial monitor volume — `0.8`, byte-identical to the design-system
 * `VolumeSlider`'s historical default, so the audition starts at the level the
 * slider shows.
 */
const INITIAL_VOLUME = 0.8;

/**
 * Initial cross-view sync state for the `SyncProvider` mounted around the
 * workspace. The cursor / selection start empty (set by clicking a view); the
 * `timeRange` is a placeholder — the per-source views still derive their own
 * window, so `timeRange` is plumbed but not yet consumed (no zoom UI).
 */
const INITIAL_SYNC_STATE: SyncState = {
	cursor: null,
	selection: null,
	timeRange: { start: 0, end: 0 },
};

// The initial transport control, before the active view publishes its own. Not
// disabled — the default active view (Overlay) has playback.
const INITIAL_TRANSPORT_CONTROL: TransportControl = {
	disabled: false,
	playing: false,
	positionSec: 0,
	durationSec: 0,
	onPlayToggle: () => {},
	onSeek: () => {},
};

/**
 * Normalize a design-system `Source` to its serializable `SourceState` mirror —
 * plain data only, no PCM, no functions. `timelineOffsetMs` is clamped to ≥ 0:
 * the comparison's timeline starts at zero, so a negative offset is invalid.
 */
function toSourceState(source: Source): SourceState {
	return {
		id: source.id,
		name: source.name,
		audioFilePath: source.audioFilePath,
		timelineOffsetMs: Math.max(0, source.timelineOffsetMs),
		layerColor: { primary: source.layerColor.primary, secondary: source.layerColor.secondary },
		visible: source.visible,
		muted: source.muted,
		soloed: source.soloed,
	};
}

/**
 * ComparisonTab — mounts the design-system workspace shell (`AppShell` +
 * `SourcesPanel` + `Workspace` + `Transport`) for one comparison, the same
 * composition the `design-system-demo` proves but fed by the desktop's valtio
 * comparison state instead of React `useState`.
 *
 * The workspace components stay controlled — `sources` flows down from the
 * comparison state, `onChange` mutates it back through `appStore.mutate`. Each
 * source's audio file is decoded by `useSourceAudio` and supplied to the
 * `Workspace` as a `sourceId → AudioData` map; a still-decoding source is
 * simply absent from the map and skipped by the views.
 */
export function ComparisonTab({ context, comparison }: Props) {
	const { app, appStore } = context;

	const [transportControl, setTransportControl] = useState<TransportControl>(
		INITIAL_TRANSPORT_CONTROL,
	);

	// Monitor volume — controlled state for the Transport's `VolumeSlider`. Kept
	// transient (not in the autosaved comparison state): it is a playback-side
	// monitoring preference, not analytical comparison content, so it should not
	// enter `state.json` or the Phase-8 undo/redo history. `usePlayer` applies
	// it to whichever player the active view builds.
	const [volume, setVolume] = useState(INITIAL_VOLUME);

	// Cross-view sync on/off — controlled state for the `ViewTabs` Sync toggle
	// and the `SyncProvider` mounted around the workspace. Kept transient (not
	// in the autosaved comparison state): like monitor volume it is an
	// inspection-side preference, not analytical content, so it stays out of
	// `state.json` and the Phase-8 undo/redo history. When on, the per-source
	// views read/write a shared cursor / selection; when off they are
	// independent.
	const [syncEnabled, setSyncEnabled] = useState(false);

	// The comparison's sources, as the design-system `Source` shape. The
	// serializable `SourceState` mirror is structurally a `Source`; the valtio
	// snapshot is deeply readonly, matching `Source`'s readonly fields.
	const sources: ReadonlyArray<Source> = comparison.sources;

	// The active view tab. `Workspace`'s active view is a controlled prop so
	// this host knows which derived render (Sum vs Difference) to resolve; the
	// `Comparison` state already carries `activeView`, persisted by `useAutosave`.
	const activeView = comparison.activeView;

	// Per-source decoded audio. `useSourceAudio` decodes each source's file
	// (cached by path) and reports per-source decode status. `sourceBuffers`
	// holds the raw `AudioBuffer`s the live `MixPlayer` schedules.
	const { sourceAudio, sourceBuffers, status } = useSourceAudio(sources);

	// The ffmpeg-rendered derived signal for whichever derived view is active.
	// `derivedOperationFor` returns `null` for a non-derived view, which makes
	// `useDerivedAudio` a no-op (no render dispatched) — so this unconditional
	// hook call never spawns ffmpeg for a view that shows no derived signal.
	const derivedOperation = derivedOperationFor(activeView);
	const derived = useDerivedAudio(sources, derivedOperation);

	// The `AudioData` routed into the derived view: the decoded render once
	// `ready`, an empty zero-duration reader while `rendering` / `empty` (the
	// view shows its built-in empty state and an overlay is painted on top).
	const derivedAudio = derived.status === "ready" && derived.audioData ? derived.audioData : EMPTY_DERIVED_AUDIO;

	// The overlay message for a derived view that is not yet showing real audio:
	// "Rendering…" while ffmpeg runs, an empty-state line when a Difference has
	// fewer than two audible sources (or a Sum has none). `null` when no derived
	// view is active or its render is `ready` — no overlay.
	const derivedOverlayMessage = useMemo(() => {
		if (derivedOperation === null || derived.status === "ready") return null;

		if (derived.status === "rendering") return "Rendering…";

		return derivedOperation === "difference"
			? "Difference needs at least two audible sources"
			: "No audible sources";
	}, [derivedOperation, derived.status]);

	// True while at least one source's file is still decoding — drives the
	// "Decoding audio…" overlay. A file-less or failed source is `error`, not
	// `loading`, so it does not keep the indicator up.
	const decoding = useMemo(
		() => sources.some((source) => status.get(source.id) === "loading"),
		[sources, status],
	);

	// --- Playback ------------------------------------------------------------

	// The playback path the active view uses — `file` (Sum / Difference, the
	// ffmpeg temp file), `mix` (per-source / chart, the live audible mix), or
	// `none` (Frequency Distribution / Vectorscope have no playback).
	const playbackKind = playbackKindFor(activeView);

	// The comparison's persisted playhead. Read once into a ref as the player's
	// initial / restore position — re-reading `comparison.positionSec` on every
	// render (it is bumped by the persist below) would re-seek the player.
	const initialPositionRef = useRef(comparison.positionSec);

	/**
	 * Persist the transport playhead into the comparison's `positionSec`, where
	 * `useAutosave` carries it into `state.json`. `usePlayer` calls this only on
	 * discrete events (pause, seek, view switch) — never per animation frame —
	 * so this does not thrash the autosave.
	 */
	const persistPosition = useCallback(
		(positionSec: number) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.positionSec = positionSec;
			});
		},
		[app, appStore, comparison.id],
	);

	// The active view's player. `usePlayer` builds a `PlaybackEngine` for a
	// `file` view (pointed at the derived render's temp path) or a `MixPlayer`
	// for a `mix` view (over the audible source buffers), and exposes a uniform
	// play / pause / seek / position API regardless of which is active. `volume`
	// is applied to whichever player it builds so a freshly-constructed player
	// (view switch, mix rebuild) starts at the current monitor level.
	const player = usePlayer(
		playbackKind,
		sources,
		sourceBuffers,
		derived.filePath,
		initialPositionRef.current,
		persistPosition,
		volume,
	);

	/**
	 * Route a monitor-volume change from the Transport's `VolumeSlider` — store
	 * the controlled value and drive the active player's master gain. The
	 * `VolumeSlider` is a purely visual design-system component; the desktop app
	 * owns the volume state.
	 */
	const handleVolumeChange = useCallback(
		(next: number) => {
			setVolume(next);
			player.onVolumeChange(next);
		},
		[player],
	);

	/**
	 * The `TransportControl` handed to the Transport widget. The active view
	 * publishes its own control (via `onTransportControlChange`) carrying the
	 * view-owned `durationSec`, `cursorReadout`, and selection markers; the
	 * desktop host substitutes the *playback* fields — `playing`, `positionSec`,
	 * `onPlayToggle`, `onSeek` — with the real player's, and uses the player's
	 * `durationSec` (the actual audio length) when the player knows it. A
	 * `disabled` view (Frequency Distribution / Vectorscope) is passed through
	 * untouched — there is no player to bind.
	 */
	const boundTransportControl = useMemo<TransportControl>(() => {
		if (transportControl.disabled || playbackKind === "none") {
			return transportControl;
		}

		return {
			...transportControl,
			playing: player.playing,
			positionSec: player.positionSec,
			durationSec: player.durationSec > 0 ? player.durationSec : transportControl.durationSec,
			onPlayToggle: player.onPlayToggle,
			onSeek: player.onSeek,
		};
	}, [transportControl, playbackKind, player]);

	/**
	 * Append `SourceState`s to this comparison. Layer colors continue the
	 * round-robin from the current source count so newly added sources stay
	 * visually distinct.
	 */
	const appendSources = useCallback(
		(filePaths: ReadonlyArray<string>) => {
			if (filePaths.length === 0) return;

			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				const base = target.sources.length;

				for (const [offset, filePath] of filePaths.entries()) {
					target.sources.push(createSourceFromFile(filePath, base + offset));
				}
			});
		},
		[app, appStore, comparison.id],
	);

	/**
	 * Open the audio-file dialog and append the chosen files as new sources —
	 * the real behaviour behind the sources panel's "Add Source" affordance.
	 */
	const addSourcesFromDialog = useCallback(async () => {
		const filePaths = await main.showOpenDialog({
			filters: [{ name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
			properties: ["openFile", "multiSelections"],
		});

		if (!filePaths || filePaths.length === 0) return;

		appendSources(filePaths);
	}, [appendSources]);

	/**
	 * Re-place a source on the comparison's shared timeline — wired to
	 * `TimelineView`'s `onSourceOffsetChange`. The design-system `TimelineView`
	 * owns no placement state: it renders each strip's position from
	 * `Source.timelineOffsetMs` and emits drag results out through this
	 * callback. The desktop app is the state owner — it writes the new offset
	 * (clamped ≥ 0, the comparison timeline starts at zero) into the valtio
	 * comparison state, where `useAutosave` persists it through `state.json`.
	 */
	const handleSourceOffsetChange = useCallback(
		(sourceId: string, offsetMs: number) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				const source = target.sources.find((entry) => entry.id === sourceId);

				if (!source) return;

				source.timelineOffsetMs = Math.max(0, offsetMs);
			});
		},
		[app, appStore, comparison.id],
	);

	// `SourcesPanel`'s canonical mutation channel — covers add, remove, and
	// per-row property changes. A bare "Add Source" (a file-less appended row)
	// is intercepted and routed to the file dialog; every other change writes
	// the next source array (clamped) into the store.
	const handleSourcesChange = useCallback(
		(next: ReadonlyArray<Source>) => {
			if (isBareAddSource(sources, next)) {
				void addSourcesFromDialog();

				return;
			}

			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.sources = next.map(toSourceState);
			});
		},
		[app, appStore, comparison.id, sources, addSourcesFromDialog],
	);

	// `Workspace`'s controlled active-view channel — writes the selected view
	// into the comparison state, where `useAutosave` persists it. Switching to
	// the Sum / Difference tab is what makes `useDerivedAudio` resolve a render.
	const handleActiveViewChange = useCallback(
		(view: ViewId) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.activeView = view;
			});
		},
		[app, appStore, comparison.id],
	);

	// --- Undo / redo ---------------------------------------------------------

	// The comparison-edit history. `useComparisonHistory` observes the
	// `comparison` snapshot prop, pushes a history entry on each user edit
	// (source add/remove, timeline offset, mute/solo/visibility, view / channel
	// / selection state — the transient `positionSec` is excluded), and exposes
	// `undo`/`redo` that restore a snapshot back into the valtio proxy. The
	// actions-cluster undo/redo buttons in `ViewTabs` are controlled by this.
	const { undo, redo, canUndo, canRedo } = useComparisonHistory(comparison, app, appStore);

	// Workspace-level keyboard shortcuts: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z
	// (or Ctrl/Cmd+Y) redoes. Bound on `window` so the shortcut works regardless
	// of which workspace control has focus; skipped while a text input / textarea
	// is focused so it never hijacks an in-field edit (e.g. renaming a source).
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey)) return;

			const key = event.key.toLowerCase();

			if (key !== "z" && key !== "y") return;

			const target = event.target;
			const isTextEntry =
				target instanceof HTMLElement &&
				(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

			if (isTextEntry) return;

			// `key` is `"z" | "y"` here. Ctrl/Cmd+Y, or Ctrl/Cmd+Shift+Z, is redo;
			// a plain Ctrl/Cmd+Z is undo.
			const isRedo = key === "y" || event.shiftKey;

			event.preventDefault();

			if (isRedo) {
				redo();
			} else {
				undo();
			}
		};

		window.addEventListener("keydown", onKeyDown);

		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [undo, redo]);

	return (
		<div className="relative flex flex-1 flex-col bg-void">
			<AppShell
				sidebar={
					<SourcesPanel
						sources={sources}
						onChange={handleSourcesChange}
					/>
				}
				workspace={
					// `SyncProvider` owns the shared cross-view cursor / selection /
					// time-range; `syncEnabled` (controlled here) gates whether the
					// views read it or fall back to their own local state. The
					// `Workspace` forwards `syncEnabled` to the `ViewTabs` Sync toggle.
					<SyncProvider enabled={syncEnabled} initial={INITIAL_SYNC_STATE}>
						<Workspace
							sources={sources}
							sourceAudio={sourceAudio}
							derivedAudio={derivedAudio}
							activeView={activeView}
							onActiveViewChange={handleActiveViewChange}
							syncEnabled={syncEnabled}
							onSyncEnabledChange={setSyncEnabled}
							onUndo={undo}
							onRedo={redo}
							canUndo={canUndo}
							canRedo={canRedo}
							onSourceOffsetChange={handleSourceOffsetChange}
							onTransportControlChange={setTransportControl}
						/>
					</SyncProvider>
				}
				transport={
					boundTransportControl.disabled ? undefined : (
						<Transport
							control={boundTransportControl}
							volume={volume}
							onVolumeChange={handleVolumeChange}
						/>
					)
				}
			/>
			{decoding && (
				<div className="pointer-events-none absolute right-3 top-3 z-50 flex items-center gap-2 bg-chrome-raised px-2 py-1">
					<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
						Decoding audio…
					</span>
				</div>
			)}
			{derivedOverlayMessage !== null && (
				// The derived (Sum / Difference) view shows no real signal yet — its
				// ffmpeg render is in flight, or there is nothing to render. The view
				// chrome stays mounted and navigable underneath (`pointer-events-none`);
				// the message is centred over the workspace pane.
				<div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
					<span className="bg-chrome-raised px-3 py-1.5 font-technical text-sm uppercase tracking-[0.06em] text-chrome-text-secondary">
						{derivedOverlayMessage}
					</span>
				</div>
			)}
		</div>
	);
}
