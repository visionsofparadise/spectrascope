import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackEngine } from "./PlaybackEngine";
import type { Player } from "./Player";

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

/**
 * Own the active view's playback player and expose a uniform transport API.
 *
 * Every audible view plays one registered `media://` stream through a single
 * `PlaybackEngine`: the per-source and Sum views point at the sum-of-audible
 * stream, Difference points at the diff stream, and Frequency Distribution /
 * Vectorscope have no player (`streamUrl === null`). A live mix *is* a sum, so
 * there is no separate mix player — a parameter change (mute / solo / offset /
 * A/B) is a URL swap on the same engine.
 *
 * The engine is built the first time a URL exists and disposed when it goes
 * away (a view with no playback). A URL change on the live engine is a
 * `setSourceUrl` + seek-to-current-position + resume-if-playing, so an edit
 * mid-playback rebuffers briefly but keeps the playhead and keeps playing.
 *
 * `durationSec` comes from the caller (the registered stream's exact
 * `StreamInfo.durationMs`); the `<audio>` element's own `durationchange`
 * refines it when it reports a finite value. Position is reported back through
 * `onPositionCommit` (the desktop host persists it into the comparison's
 * `positionSec`) on discrete events only, never per animation frame; the hook
 * also keeps a live `positionSec` in React state so the Transport advances.
 */
export function usePlayer(
	streamUrl: string | null,
	durationSec: number,
	initialPositionSec: number,
	onPositionCommit: (positionSec: number) => void,
	volume: number,
): UsePlayerResult {
	const [playing, setPlaying] = useState(false);
	const [positionSec, setPositionSec] = useState(initialPositionSec);
	const [reportedDurationSec, setReportedDurationSec] = useState(0);

	// The latest live position — kept in a ref so a URL swap / teardown can
	// persist it without depending on a state value that lags a frame.
	const livePositionRef = useRef(initialPositionSec);
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

	// The active player. Built while a URL exists, disposed when it goes null. A
	// URL change between two non-null values keeps the same engine (and its
	// playhead) — the URL effect below re-points it.
	const playerRef = useRef<Player | null>(null);

	const hasUrl = streamUrl !== null;

	// Build / tear down the engine on the has-url transition. Building it here
	// (not in render) keeps the Web Audio graph construction out of React's
	// render pass.
	useEffect(() => {
		if (!hasUrl) {
			playerRef.current = null;
			setPlaying(false);
			setReportedDurationSec(0);

			return;
		}

		const player = new PlaybackEngine();

		playerRef.current = player;

		// Apply the current monitor volume so a freshly-built engine starts at
		// the level the `VolumeSlider` shows rather than the engine's own `0.8`
		// construction default.
		player.setVolume(volumeRef.current);

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
		// The stream's exact duration is fed in via `durationSec`; the element's
		// own `durationchange` refines it whenever it reports a finite value (a
		// chunked stream body without Content-Length reports `0`, which the
		// engine's getter clamps — skip those so the exact value survives).
		const unsubscribeDuration = player.onDurationChange((next) => {
			if (next > 0) setReportedDurationSec(next);
		});

		return () => {
			// Persist wherever the player left off so a re-built player resumes there.
			onPositionCommitRef.current(livePositionRef.current);
			unsubscribePosition();
			unsubscribePlaying();
			unsubscribeDuration();
			player.dispose();
			playerRef.current = null;
		};
	}, [hasUrl]);

	// Point the engine at the active view's stream URL. A URL swap (an edit to
	// the audible set / offsets / A-B, or a switch between the sum and diff
	// streams) re-points the live engine, restores the playhead, and resumes if
	// it was playing — mirroring the old live-mix rebuild-resume behaviour.
	useEffect(() => {
		const player = playerRef.current;

		if (!(player instanceof PlaybackEngine) || streamUrl === null) return;

		// Capture before `setSourceUrl`, which emits position `0` synchronously.
		const resumeSec = livePositionRef.current;
		const wasPlaying = player.playing;

		const changed = player.setSourceUrl(streamUrl);

		if (!changed) return;

		player.seek(resumeSec);
		livePositionRef.current = resumeSec;
		setPositionSec(resumeSec);

		if (wasPlaying) void player.play();
	}, [streamUrl]);

	// Seed the transport duration from the registered stream's exact value on
	// every URL / duration change.
	useEffect(() => {
		if (streamUrl === null) return;

		setReportedDurationSec(durationSec);
	}, [streamUrl, durationSec]);

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
		setPositionSec(sec);
		onPositionCommitRef.current(sec);
	}, []);

	const onVolumeChange = useCallback((volume: number) => {
		playerRef.current?.setVolume(volume);
	}, []);

	return { playing, positionSec, durationSec: reportedDurationSec, onPlayToggle, onSeek, onVolumeChange };
}
