import { useCallback, useEffect, useMemo, useState } from "react";
import { useTimeViewport } from "../useTimeViewport";
import type { TransportControl } from "../Transport";
import type { AudioData } from "./types";

export function useViewportScrub(chromeAudio: AudioData) {
	const viewport = useTimeViewport(0, chromeAudio.durationMs);

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
	const [playing, setPlaying] = useState(false);
	const [positionSec, setPositionSec] = useState(0);

	const onPlayToggle = useCallback(() => {
		setPlaying((previous) => !previous);
	}, []);

	const onSeek = useCallback(
		(sec: number) => {
			setPositionSec(Math.max(0, Math.min(durationSec, sec)));
		},
		[durationSec],
	);

	return useMemo(
		() => ({ playing, positionSec, durationSec, onPlayToggle, onSeek }),
		[playing, positionSec, durationSec, onPlayToggle, onSeek],
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
