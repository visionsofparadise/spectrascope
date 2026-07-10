import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Source } from "@spectrascope/design-system";
import { MixPlayer } from "./MixPlayer";
import type { MixSource } from "./MixPlayer";
import { PlaybackEngine } from "./PlaybackEngine";
import type { Player } from "./Player";

/**
 * Which playback path the active view uses.
 *
 * - `mix` — the per-source / chart views audition a live `MixPlayer` over the
 *   audible source buffers.
 * - `file` — the Sum / Difference views audition the single ffmpeg-rendered
 *   temp file through a `PlaybackEngine`.
 * - `none` — the view has no playback (Frequency Distribution, Vectorscope).
 */
export type PlaybackKind = "mix" | "file" | "none";

export interface UsePlayerResult {
	/** Whether playback is currently running. */
	readonly playing: boolean;
	/** The current playback position in seconds. */
	readonly positionSec: number;
	/** The active player's total duration in seconds (`0` when no player). */
	readonly durationSec: number;
	/** Toggle play / pause on the active player. No-op when there is no player. */
	readonly onPlayToggle: () => void;
	/** Seek the active player to an absolute position in seconds. */
	readonly onSeek: (sec: number) => void;
	/** Set the active player's master / monitor gain (`0`–`1`). */
	readonly onVolumeChange: (volume: number) => void;
}

/** Resolve the audible source set — solo overrides mute (`visible` is display-only). */
function resolveAudibleSources(sources: ReadonlyArray<Source>): ReadonlyArray<Source> {
	const anySoloed = sources.some((source) => source.soloed);

	if (anySoloed) {
		return sources.filter((source) => source.soloed);
	}

	return sources.filter((source) => !source.muted);
}

/**
 * Stable identity for the live-mix audible set — the ordered list of audible
 * source ids and their timeline offsets. The `MixPlayer` is rebuilt only when
 * this key changes (a source muted / soloed / moved / added / removed), so a
 * re-render that does not touch the audible set keeps the same player and
 * preserves the playhead.
 */
function mixKey(mixSources: ReadonlyArray<MixSource>): string {
	return mixSources.map((source) => `${source.id}@${String(source.timelineOffsetMs)}`).join("|");
}

/**
 * Own the active view's playback player and expose a uniform transport API.
 *
 * Per the design's playback split, the player kind depends on the active view:
 * the Sum / Difference views audition the ffmpeg-rendered temp file through a
 * `PlaybackEngine` (`kind: "file"`, `filePath` set); the per-source / chart
 * views audition a live `MixPlayer` over the audible source `AudioBuffer`s
 * (`kind: "mix"`). Both implement the `Player` interface, so this hook drives
 * either through the same `play` / `pause` / `seek` / `setVolume` calls and the
 * same position / playing subscriptions.
 *
 * The `MixPlayer` is rebuilt when the audible set changes (mute / solo /
 * offset / add / remove) so a live mix always reflects the current comparison.
 * The `PlaybackEngine` is built once and re-pointed at a new `filePath` via
 * `setSource` when the derived render changes. Switching views disposes the
 * old player and constructs the kind the new view needs.
 *
 * `onPositionChange` is reported back through `onPositionCommit` (the desktop
 * host persists it into the comparison's `positionSec`); the hook also keeps a
 * live `positionSec` in React state so the Transport timecode advances.
 */
export function usePlayer(
	kind: PlaybackKind,
	sources: ReadonlyArray<Source>,
	sourceBuffers: ReadonlyMap<string, AudioBuffer>,
	derivedFilePath: string | undefined,
	initialPositionSec: number,
	onPositionCommit: (positionSec: number) => void,
	volume: number,
): UsePlayerResult {
	const [playing, setPlaying] = useState(false);
	const [positionSec, setPositionSec] = useState(initialPositionSec);
	const [durationSec, setDurationSec] = useState(0);

	// The latest live position — kept in a ref so `pause`/view-switch can
	// persist it without depending on a state value that lags a frame.
	const livePositionRef = useRef(initialPositionSec);
	// The position to restore a freshly-built player to (the comparison's
	// persisted `positionSec`, or wherever the previous player left off).
	const restorePositionRef = useRef(initialPositionSec);
	const onPositionCommitRef = useRef(onPositionCommit);
	// The current monitor volume — kept in a ref so the player-build effect can
	// apply it to a freshly-constructed player without `volume` being one of its
	// dependencies (which would rebuild the player on every volume drag).
	const volumeRef = useRef(volume);

	useEffect(() => {
		onPositionCommitRef.current = onPositionCommit;
	}, [onPositionCommit]);

	useEffect(() => {
		volumeRef.current = volume;
	}, [volume]);

	// The audible source buffers for the live mix, ordered by the comparison's
	// source order. A source with no decoded buffer yet is skipped.
	const mixSources = useMemo<ReadonlyArray<MixSource>>(() => {
		if (kind !== "mix") return [];

		const audible = resolveAudibleSources(sources);
		const result: Array<MixSource> = [];

		for (const source of audible) {
			const audioBuffer = sourceBuffers.get(source.id);

			if (!audioBuffer) continue;

			result.push({ id: source.id, audioBuffer, timelineOffsetMs: Math.max(0, source.timelineOffsetMs) });
		}

		return result;
	}, [kind, sources, sourceBuffers]);

	// The identity the `MixPlayer` is rebuilt on — changes when the audible set,
	// the offsets, or their decoded buffers change.
	const mixIdentity = useMemo(() => mixKey(mixSources), [mixSources]);

	// The active player. Rebuilt when the player *kind* changes, or — for a mix
	// — when the audible set changes. A re-render that touches neither keeps the
	// existing player (and its playhead).
	const playerRef = useRef<Player | null>(null);

	// What the disposed player was, captured by the build effect's cleanup so
	// the next build can resume playback after a mid-playback `MixPlayer`
	// rebuild (a mute/solo/move edit) — the live mix must "reflect mute/solo
	// edits instantly", i.e. keep playing across the rebuild.
	const priorPlayerRef = useRef<{ readonly kind: PlaybackKind; readonly wasPlaying: boolean } | null>(null);

	useEffect(() => {
		// Consume the prior-player record once per build — it describes only the
		// immediately-disposed player, so the resume check below must not see a
		// record left over from an earlier teardown.
		const prior = priorPlayerRef.current;

		priorPlayerRef.current = null;

		// `file` and `none` players carry no per-render identity; `mix` rebuilds
		// per `mixIdentity`. Building the player here (not in render) keeps the
		// Web Audio graph construction out of React's render pass.
		let player: Player | null = null;

		if (kind === "mix") {
			player = new MixPlayer(mixSources);
		} else if (kind === "file") {
			player = new PlaybackEngine();
		}

		playerRef.current = player;

		if (player === null) {
			setPlaying(false);
			setDurationSec(0);

			return;
		}

		// Apply the current monitor volume so a freshly-built player (view
		// switch, mix rebuild) starts at the level the `VolumeSlider` shows
		// rather than the player's own `0.8` construction default.
		player.setVolume(volumeRef.current);

		const restoreSec = restorePositionRef.current;

		const unsubscribePosition = player.onPositionChange((next) => {
			livePositionRef.current = next;
			setPositionSec(next);
		});
		const unsubscribePlaying = player.onPlayingChange((next) => {
			setPlaying(next);

			// Playback stopping (pause or natural end) is a good moment to
			// persist the position into the comparison state.
			if (!next) {
				onPositionCommitRef.current(livePositionRef.current);
			}
		});

		if (player instanceof MixPlayer) {
			setDurationSec(player.durationSec);
			player.seek(restoreSec);
			setPositionSec(player.positionSec);

			// Resume after a mid-playback `MixPlayer` rebuild. The build effect
			// reruns when `mixIdentity` changes — a source muted / soloed / moved
			// while the live mix is playing disposes the old `MixPlayer` and
			// constructs a fresh one seek-restored to the playhead. Without this
			// the mix would silently pause; the design requires the live mix to
			// "reflect mute/solo edits instantly", i.e. keep playing. Only resume
			// when the prior player was also a playing mix (`kind` unchanged) — a
			// view switch *into* a mix view must not auto-start playback.
			if (prior !== null && prior.kind === "mix" && prior.wasPlaying) {
				void player.play();
			}
		}

		return () => {
			// Persist wherever the player left off so the next player resumes there.
			restorePositionRef.current = livePositionRef.current;
			onPositionCommitRef.current(livePositionRef.current);
			// Record what this player was so the next build can resume a
			// mid-playback mix rebuild (see the resume branch above).
			priorPlayerRef.current = { kind, wasPlaying: player.playing };
			unsubscribePosition();
			unsubscribePlaying();
			player.dispose();
			playerRef.current = null;
		};
		// `mixIdentity` (not `mixSources`) gates the mix rebuild — a stable
		// audible set keeps the player even as `mixSources` is a fresh array.
		 
	}, [kind, mixIdentity]);

	// Point the `PlaybackEngine` at the derived render's temp file. `setSource`
	// is a no-op when the path is unchanged, so this does not reload the
	// `<audio>` element on an unrelated re-render.
	//
	// `<audio>` reports its duration asynchronously once metadata loads. The
	// duration is read by *subscribing* to the engine's `onDurationChange` (the
	// element's `durationchange` / `loadedmetadata` events) — not by polling on
	// a fixed window, which gave up after ~4s and left the Transport stuck at
	// `00:00.000` total whenever metadata took longer.
	useEffect(() => {
		const player = playerRef.current;

		if (kind !== "file" || !(player instanceof PlaybackEngine)) return;

		if (derivedFilePath === undefined) return;

		const changed = player.setSource(derivedFilePath);

		if (changed) {
			player.seek(0);
			setPositionSec(0);
		}

		// Seed with the current value (already known for an unchanged source)
		// then track every subsequent duration update for the life of the source.
		setDurationSec(player.durationSec);

		return player.onDurationChange((next) => {
			setDurationSec(next);
		});
	}, [kind, derivedFilePath]);

	const onPlayToggle = useCallback(() => {
		const player = playerRef.current;

		if (!player) return;

		if (player.playing) {
			player.pause();
		} else {
			void player.play();
		}
	}, []);

	const onSeek = useCallback((sec: number) => {
		const player = playerRef.current;

		if (!player) return;

		player.seek(sec);
		livePositionRef.current = sec;
		restorePositionRef.current = sec;
		setPositionSec(sec);
		onPositionCommitRef.current(sec);
	}, []);

	const onVolumeChange = useCallback((volume: number) => {
		playerRef.current?.setVolume(volume);
	}, []);

	return { playing, positionSec, durationSec, onPlayToggle, onSeek, onVolumeChange };
}
