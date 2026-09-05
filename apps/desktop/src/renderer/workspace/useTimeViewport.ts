import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface TimeWindow {
	readonly startMs: number;
	readonly endMs: number;
}

const MIN_WINDOW_MS = 10;

const COMMIT_DEBOUNCE_MS = 150;

const ZOOM_SENSITIVITY = 0.002;

export function clampWindowToExtent(window: TimeWindow, extent: TimeWindow): TimeWindow {
	const extentSpan = extent.endMs - extent.startMs;

	if (extentSpan <= 0) {
		return { startMs: extent.startMs, endMs: extent.startMs };
	}

	const span = Math.min(window.endMs - window.startMs, extentSpan);
	let start = window.startMs;
	let end = start + span;

	if (start < extent.startMs) {
		start = extent.startMs;
		end = start + span;
	}

	if (end > extent.endMs) {
		end = extent.endMs;
		start = end - span;
	}

	return { startMs: start, endMs: end };
}

export function panWindow(window: TimeWindow, deltaFrac: number, extent: TimeWindow): TimeWindow {
	const span = window.endMs - window.startMs;
	const shift = deltaFrac * span;

	return clampWindowToExtent({ startMs: window.startMs + shift, endMs: window.endMs + shift }, extent);
}

export function zoomWindow(
	window: TimeWindow,
	factor: number,
	cursorFrac: number,
	extent: TimeWindow,
	minWindowMs: number,
): TimeWindow {
	const span = window.endMs - window.startMs;
	const extentSpan = extent.endMs - extent.startMs;
	const cursorTime = window.startMs + cursorFrac * span;
	const maxSpan = extentSpan > 0 ? extentSpan : span;
	const newSpan = Math.min(Math.max(span * factor, minWindowMs), maxSpan);
	const start = cursorTime - cursorFrac * newSpan;

	return clampWindowToExtent({ startMs: start, endMs: start + newSpan }, extent);
}

function reconcileToExtent(current: TimeWindow, previousExtent: TimeWindow, nextExtent: TimeWindow): TimeWindow {
	const wasFull = current.startMs <= previousExtent.startMs && current.endMs >= previousExtent.endMs;

	if (wasFull || current.endMs <= current.startMs) {
		return { startMs: nextExtent.startMs, endMs: nextExtent.endMs };
	}

	return clampWindowToExtent(current, nextExtent);
}

export function computeWindowTransform(rendered: TimeWindow, live: TimeWindow): string {
	const liveSpan = live.endMs - live.startMs;

	if (liveSpan <= 0) return "translateX(0%) scaleX(1)";

	const renderedSpan = rendered.endMs - rendered.startMs;
	const scaleX = renderedSpan / liveSpan;
	const translateFrac = (rendered.startMs - live.startMs) / liveSpan;

	return `translateX(${translateFrac * 100}%) scaleX(${scaleX})`;
}

export interface TimeViewport {
	readonly startMs: number;
	readonly endMs: number;
	readonly committedStartMs: number;
	readonly committedEndMs: number;
	/**
	 * CSS `translateX`/`scaleX` mapping the committed window onto the live one,
	 * for a canvas-wrapping div (`transform-origin: left`). Identity when settled.
	 */
	readonly transform: string;
	readonly wheelHandlers: { readonly ref: React.RefObject<HTMLDivElement | null> };
	readonly setViewport: (window: TimeWindow) => void;
}

export function useTimeViewport(extentStartMs: number, extentEndMs: number): TimeViewport {
	const [live, setLive] = useState<TimeWindow>({ startMs: extentStartMs, endMs: extentEndMs });
	const [committed, setCommitted] = useState<TimeWindow>({
		startMs: extentStartMs,
		endMs: extentEndMs,
	});

	const wheelTargetRef = useRef<HTMLDivElement | null>(null);
	const liveRef = useRef(live);
	const extentRef = useRef<TimeWindow>({ startMs: extentStartMs, endMs: extentEndMs });
	const previousExtentRef = useRef<TimeWindow>({ startMs: extentStartMs, endMs: extentEndMs });
	const commitTimerRef = useRef<number | null>(null);

	liveRef.current = live;
	extentRef.current = { startMs: extentStartMs, endMs: extentEndMs };

	const scheduleCommit = useCallback(() => {
		if (commitTimerRef.current !== null) {
			window.clearTimeout(commitTimerRef.current);
		}

		commitTimerRef.current = window.setTimeout(() => {
			commitTimerRef.current = null;
			setCommitted(liveRef.current);
		}, COMMIT_DEBOUNCE_MS);
	}, []);

	useEffect(() => {
		const previous = previousExtentRef.current;

		if (previous.startMs === extentStartMs && previous.endMs === extentEndMs) return;

		const nextExtent = { startMs: extentStartMs, endMs: extentEndMs };

		previousExtentRef.current = nextExtent;
		setLive((current) => reconcileToExtent(current, previous, nextExtent));
		setCommitted((current) => reconcileToExtent(current, previous, nextExtent));
	}, [extentStartMs, extentEndMs]);

	useEffect(() => {
		const element = wheelTargetRef.current;

		if (!element) return;

		const onWheel = (event: WheelEvent) => {
			event.preventDefault();

			const rect = element.getBoundingClientRect();

			if (event.ctrlKey || event.metaKey) {
				const factor = Math.exp(event.deltaY * ZOOM_SENSITIVITY);
				const cursorFrac =
					rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0.5;

				setLive((current) => zoomWindow(current, factor, cursorFrac, extentRef.current, MIN_WINDOW_MS));
			} else {
				const deltaFrac = rect.height > 0 ? event.deltaY / rect.height : 0;

				setLive((current) => panWindow(current, deltaFrac, extentRef.current));
			}

			scheduleCommit();
		};

		element.addEventListener("wheel", onWheel, { passive: false });

		return () => {
			element.removeEventListener("wheel", onWheel);
		};
	}, [scheduleCommit]);

	useEffect(
		() => () => {
			if (commitTimerRef.current !== null) {
				window.clearTimeout(commitTimerRef.current);
			}
		},
		[],
	);

	const setViewport = useCallback(
		(next: TimeWindow) => {
			setLive(clampWindowToExtent(next, extentRef.current));
			scheduleCommit();
		},
		[scheduleCommit],
	);

	const transform = useMemo(() => computeWindowTransform(committed, live), [live, committed]);

	const wheelHandlers = useMemo(() => ({ ref: wheelTargetRef }), []);

	return {
		startMs: live.startMs,
		endMs: live.endMs,
		committedStartMs: committed.startMs,
		committedEndMs: committed.endMs,
		transform,
		wheelHandlers,
		setViewport,
	};
}
