import { identify, subscribe } from "opshot";
import { useEffect, useRef, useState } from "react";
import { PlaybackEngine } from "./PlaybackEngine";
import type { PlaybackControls, PlaybackState } from "../models/State/Playback";
import type { Session } from "../models/State/Session";

function messageOf(reason: unknown): string {
	return reason instanceof Error ? reason.message : String(reason);
}

export function usePlayer(
	streamUrl: string | null,
	durationSec: number,
	preparing: boolean,
	selection: { readonly start: number; readonly end: number } | null,
	playback: PlaybackState,
	session: Session,
): PlaybackControls {
	const { document, transport } = session;
	const playerRef = useRef<PlaybackEngine | null>(null);
	const resumeAfterPreparationRef = useRef(false);
	const streamUrlRef = useRef(streamUrl);

	streamUrlRef.current = streamUrl;

	const [controls] = useState<PlaybackControls>(() => ({
		onPlayToggle: () => {
			const player = playerRef.current;

			if (!player) return;

			playback.error = null;

			if (player.playing || resumeAfterPreparationRef.current) {
				resumeAfterPreparationRef.current = false;
				player.pause();
			} else if (streamUrlRef.current !== null) {
				if (player.positionSec >= player.durationSec) player.seek(0);

				void player.play().catch((reason: unknown) => {
					playback.error = messageOf(reason);
					player.pause();
				});
			}
		},
		onSeek: (sec: number) => {
			const player = playerRef.current;

			if (!player || streamUrlRef.current === null) return;

			player.seek(sec);
			transport.positionSec = player.positionSec;
		},
		onVolumeChange: (volume: number) => playerRef.current?.setVolume(volume),
	}));

	useEffect(() => {
		const player = new PlaybackEngine();

		playerRef.current = player;
		player.setVolume(document.volume);
		player.setPlaybackRate(transport.playbackRate);

		const unsubscribePosition = player.onPositionChange((next) => {
			playback.positionSec = next;
		});
		const unsubscribePlaying = player.onPlayingChange((next) => {
			playback.playing = next;

			if (!next) transport.positionSec = playback.positionSec;
		});
		const unsubscribeDuration = player.onDurationChange((next) => {
			playback.durationSec = next;
		});
		const unsubscribeError = player.onError((message) => {
			playback.error = message;
		});

		return () => {
			transport.positionSec = playback.positionSec;
			unsubscribePosition();
			unsubscribePlaying();
			unsubscribeDuration();
			unsubscribeError();
			player.dispose();
			playerRef.current = null;
		};
	}, []);

	useEffect(
		() =>
			subscribe(document, (operations) => {
				if (operations.some((operation) => operation.key === "volume"))
					playerRef.current?.setVolume(document.volume);
			}),
		[identify(document)],
	);

	useEffect(() => {
		const player = playerRef.current;

		if (!player) return;

		if (streamUrl === null) {
			resumeAfterPreparationRef.current = preparing && (player.playing || resumeAfterPreparationRef.current);
			player.pause();
			playback.durationSec = 0;

			return;
		}

		const resumeSec = playback.positionSec;
		const wasPlaying = player.playing || resumeAfterPreparationRef.current;

		resumeAfterPreparationRef.current = false;

		const changed = player.setSourceUrl(streamUrl, resumeSec, durationSec);

		playback.durationSec = durationSec;

		if (changed) playback.error = null;

		if (wasPlaying && !player.playing) {
			void player.play().catch((reason: unknown) => {
				playback.error = messageOf(reason);
				player.pause();
			});
		}
	}, [streamUrl, durationSec, preparing]);

	useEffect(() => {
		const player = playerRef.current;

		if (!player) return;

		player.setPlaybackRate(transport.playbackRate);

		const loopStart = selection ? Math.max(0, Math.min(player.durationSec, selection.start / 1000)) : 0;
		const loopEnd = selection ? Math.max(0, Math.min(player.durationSec, selection.end / 1000)) : player.durationSec;
		const loopRegion = loopEnd > loopStart ? { startSec: loopStart, endSec: loopEnd } : null;

		player.setLoopRegion(loopRegion);
		player.setLooping(transport.looping);

		if (
			transport.looping &&
			loopRegion &&
			(player.positionSec < loopRegion.startSec || player.positionSec >= loopRegion.endSec)
		) {
			player.seek(loopRegion.startSec);
		}
	}, [selection?.start, selection?.end, transport.looping, transport.playbackRate, streamUrl]);

	return controls;
}
