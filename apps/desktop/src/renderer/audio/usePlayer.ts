import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackEngine } from "./PlaybackEngine";
import type { Player } from "./Player";

export interface UsePlayerResult {
	readonly playing: boolean;
	readonly positionSec: number;
	readonly durationSec: number;
	readonly onPlayToggle: () => void;
	readonly onSeek: (sec: number) => void;
	readonly onVolumeChange: (volume: number) => void;
}

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

	const livePositionRef = useRef(initialPositionSec);
	const onPositionCommitRef = useRef(onPositionCommit);
	const volumeRef = useRef(volume);

	useEffect(() => {
		onPositionCommitRef.current = onPositionCommit;
	}, [onPositionCommit]);

	useEffect(() => {
		volumeRef.current = volume;
	}, [volume]);

	const playerRef = useRef<Player | null>(null);

	const hasUrl = streamUrl !== null;

	useEffect(() => {
		if (!hasUrl) {
			playerRef.current = null;
			setPlaying(false);
			setReportedDurationSec(0);

			return;
		}

		const player = new PlaybackEngine();

		playerRef.current = player;

		player.setVolume(volumeRef.current);

		const unsubscribePosition = player.onPositionChange((next) => {
			livePositionRef.current = next;
			setPositionSec(next);
		});
		const unsubscribePlaying = player.onPlayingChange((next) => {
			setPlaying(next);

			if (!next) {
				onPositionCommitRef.current(livePositionRef.current);
			}
		});
		const unsubscribeDuration = player.onDurationChange((next) => {
			if (next > 0) setReportedDurationSec(next);
		});

		return () => {
			onPositionCommitRef.current(livePositionRef.current);
			unsubscribePosition();
			unsubscribePlaying();
			unsubscribeDuration();
			player.dispose();
			playerRef.current = null;
		};
	}, [hasUrl]);

	useEffect(() => {
		const player = playerRef.current;

		if (!(player instanceof PlaybackEngine) || streamUrl === null) return;

		const resumeSec = livePositionRef.current;
		const wasPlaying = player.playing;

		const changed = player.setSourceUrl(streamUrl);

		if (!changed) return;

		player.seek(resumeSec);
		livePositionRef.current = resumeSec;
		setPositionSec(resumeSec);

		if (wasPlaying) void player.play();
	}, [streamUrl]);

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
