import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackEngine } from "./PlaybackEngine";

export interface UsePlayerResult {
	readonly playing: boolean;
	readonly positionSec: number;
	readonly durationSec: number;
	readonly onPlayToggle: () => void;
	readonly onSeek: (sec: number) => void;
	readonly onVolumeChange: (volume: number) => void;
	readonly error: string | null;
}

interface PlayerSettings {
	readonly playbackRate: number;
	readonly looping: boolean;
	readonly selection: { readonly start: number; readonly end: number } | null;
	readonly preparing: boolean;
}

const DEFAULT_SETTINGS: PlayerSettings = { playbackRate: 1, looping: false, selection: null, preparing: false };

export function usePlayer(
	streamUrl: string | null,
	durationSec: number,
	initialPositionSec: number,
	onPositionCommit: (positionSec: number) => void,
	volume: number,
	settings: PlayerSettings = DEFAULT_SETTINGS,
): UsePlayerResult {
	const [playing, setPlaying] = useState(false);
	const [positionSec, setPositionSec] = useState(initialPositionSec);
	const [reportedDurationSec, setReportedDurationSec] = useState(durationSec);
	const [error, setError] = useState<string | null>(null);
	const playerRef = useRef<PlaybackEngine | null>(null);
	const livePositionRef = useRef(initialPositionSec);
	const resumeAfterPreparationRef = useRef(false);
	const onPositionCommitRef = useRef(onPositionCommit);
	const volumeRef = useRef(volume);
	const settingsRef = useRef(settings);

	onPositionCommitRef.current = onPositionCommit;
	volumeRef.current = volume;
	settingsRef.current = settings;

	useEffect(() => {
		const player = new PlaybackEngine();

		playerRef.current = player;
		player.setVolume(volumeRef.current);
		player.setPlaybackRate(settingsRef.current.playbackRate);

		const unsubscribePosition = player.onPositionChange((next) => {
			livePositionRef.current = next;
			setPositionSec(next);
		});
		const unsubscribePlaying = player.onPlayingChange((next) => {
			setPlaying(next);

			if (!next) onPositionCommitRef.current(livePositionRef.current);
		});
		const unsubscribeDuration = player.onDurationChange((next) => setReportedDurationSec(next));
		const unsubscribeError = player.onError(setError);

		return () => {
			onPositionCommitRef.current(livePositionRef.current);
			unsubscribePosition();
			unsubscribePlaying();
			unsubscribeDuration();
			unsubscribeError();
			player.dispose();
			playerRef.current = null;
		};
	}, []);

	useEffect(() => {
		const player = playerRef.current;

		if (!player) return;

		if (streamUrl === null) {
			resumeAfterPreparationRef.current =
				settings.preparing && (player.playing || resumeAfterPreparationRef.current);
			player.pause();
			setReportedDurationSec(0);

			return;
		}

		const resumeSec = livePositionRef.current;
		const wasPlaying = player.playing || resumeAfterPreparationRef.current;

		resumeAfterPreparationRef.current = false;

		const changed = player.setSourceUrl(streamUrl, resumeSec, durationSec);

		setReportedDurationSec(durationSec);

		if (changed) setError(null);

		if (wasPlaying && !player.playing) {
			void player.play().catch((reason: unknown) => {
				setError(reason instanceof Error ? reason.message : String(reason));
				player.pause();
			});
		}
	}, [streamUrl, durationSec, settings.preparing]);

	useEffect(() => {
		const player = playerRef.current;

		if (!player) return;

		player.setPlaybackRate(settings.playbackRate);

		const loopStart = settings.selection
			? Math.max(0, Math.min(player.durationSec, settings.selection.start / 1000))
			: 0;
		const loopEnd = settings.selection
			? Math.max(0, Math.min(player.durationSec, settings.selection.end / 1000))
			: player.durationSec;
		const loopRegion = loopEnd > loopStart ? { startSec: loopStart, endSec: loopEnd } : null;

		player.setLoopRegion(loopRegion);
		player.setLooping(settings.looping);

		if (
			settings.looping &&
			loopRegion &&
			(player.positionSec < loopRegion.startSec || player.positionSec >= loopRegion.endSec)
		) {
			player.seek(loopRegion.startSec);
		}
	}, [settings.playbackRate, settings.looping, settings.selection, streamUrl]);

	const onPlayToggle = useCallback(() => {
		const player = playerRef.current;

		if (!player) return;

		setError(null);

		if (player.playing || resumeAfterPreparationRef.current) {
			resumeAfterPreparationRef.current = false;
			player.pause();
		} else if (streamUrl !== null) {
			if (player.positionSec >= player.durationSec) player.seek(0);

			void player.play().catch((reason: unknown) => {
				setError(reason instanceof Error ? reason.message : String(reason));
				player.pause();
			});
		}
	}, [streamUrl]);

	const onSeek = useCallback(
		(sec: number) => {
			const player = playerRef.current;

			if (!player || streamUrl === null) return;

			player.seek(sec);
			onPositionCommitRef.current(player.positionSec);
		},
		[streamUrl],
	);
	const onVolumeChange = useCallback((next: number) => playerRef.current?.setVolume(next), []);

	return { playing, positionSec, durationSec: reportedDurationSec, onPlayToggle, onSeek, onVolumeChange, error };
}
