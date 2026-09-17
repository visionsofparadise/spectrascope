import { useCallback, useEffect, useMemo, useState } from "react";
import { useTimeViewport } from "../useTimeViewport";
import { FULL_AXIS_RANGE } from "../utils/axisRange";
import type { TransportControl, TransportReadoutRow } from "../Transport";
import type { AudioData } from "./types";
import type { AxisRange } from "../utils/axisRange";

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

function pointerRangeValuesOf(
	event: React.MouseEvent<HTMLElement>,
	xRange: AxisRange,
	yRange: AxisRange,
): { readonly x: number; readonly y: number } | null {
	const rect = event.currentTarget.getBoundingClientRect();

	if (rect.width <= 0 || rect.height <= 0) return null;

	const xFrac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
	const yFrac = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

	return {
		x: xRange.start + xFrac * (xRange.end - xRange.start),
		y: yRange.start + yFrac * (yRange.end - yRange.start),
	};
}

export function usePointerReadoutTransport(
	readoutRowsOf: (pointer: { readonly x: number; readonly y: number } | null) => ReadonlyArray<TransportReadoutRow>,
	onTransportControlChange?: (control: TransportControl) => void,
) {
	const [xRange, setXRange] = useState<AxisRange>(FULL_AXIS_RANGE);
	const [yRange, setYRange] = useState<AxisRange>(FULL_AXIS_RANGE);
	const [pointer, setPointer] = useState<{ readonly x: number; readonly y: number } | null>(null);

	const control = useMemo<TransportControl>(() => ({ readoutRows: readoutRowsOf(pointer) }), [readoutRowsOf, pointer]);

	usePublishedTransportControl(control, onTransportControlChange);

	return {
		xRange,
		setXRange,
		yRange,
		setYRange,
		onMouseMove: (event: React.MouseEvent<HTMLElement>) => setPointer(pointerRangeValuesOf(event, xRange, yRange)),
		onMouseLeave: () => setPointer(null),
	};
}
