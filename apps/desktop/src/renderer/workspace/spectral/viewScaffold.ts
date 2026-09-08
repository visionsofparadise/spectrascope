import { useCallback, useEffect, useMemo } from "react";
import { useWorkspacePlayback } from "../playback";
import { useTimeViewport } from "../useTimeViewport";
import type { TransportControl } from "../Transport";
import type { AudioData } from "./types";

export function useViewportScrub(chromeAudio: AudioData) {
	const viewport = useTimeViewport(0, chromeAudio.durationMs, false, 1000 / chromeAudio.sampleRate);

	const setViewportToFraction = useCallback(
		(fraction: number) => {
			const centerMs = fraction * chromeAudio.durationMs;
			const span = viewport.endMs - viewport.startMs;

			viewport.setViewport({ startMs: centerMs - span / 2, endMs: centerMs + span / 2 });
		},
		[chromeAudio.durationMs, viewport],
	);

	const viewStartFrac = chromeAudio.durationMs > 0 ? viewport.startMs / chromeAudio.durationMs : 0;
	const viewEndFrac = chromeAudio.durationMs > 0 ? viewport.endMs / chromeAudio.durationMs : 1;

	return { viewport, setViewportToFraction, viewStartFrac, viewEndFrac };
}

export function useTransportPlayback(durationSec: number) {
	const { playing, positionSec, onPlayToggle, onSeek, selection } = useWorkspacePlayback();

	return useMemo(
		() => ({
			playing,
			positionSec,
			durationSec,
			onPlayToggle,
			onSeek,
			selectionInSec: selection ? selection.start / 1000 : undefined,
			selectionOutSec: selection ? selection.end / 1000 : undefined,
		}),
		[playing, positionSec, durationSec, onPlayToggle, onSeek, selection],
	);
}

export function usePublishedTransportControl(
	control: TransportControl,
	onTransportControlChange?: (control: TransportControl) => void,
): void {
	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(control);
		}
	}, [control, onTransportControlChange]);
}

const DISABLED_CONTROL: TransportControl = {
	disabled: true,
	playing: false,
	positionSec: 0,
	durationSec: 0,
	onPlayToggle: () => {},
	onSeek: () => {},
};

export function useDisabledTransport(onTransportControlChange?: (control: TransportControl) => void): void {
	usePublishedTransportControl(DISABLED_CONTROL, onTransportControlChange);
}
