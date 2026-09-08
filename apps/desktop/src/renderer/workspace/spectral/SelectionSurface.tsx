import { useRef, useState } from "react";
import { useWorkspacePlayback } from "../playback";
import { extendSelection, isNestedSelectionControl, normalizeSelection } from "../utils/selection";
import { Selection } from "./Selection";
import type { SelectionGesture } from "../utils/selection";
import type { ComponentProps } from "react";

interface SelectionSurfaceProps extends ComponentProps<"div"> {
	readonly startMs: number;
	readonly endMs: number;
	readonly seekOnClick?: boolean;
}

export function SelectionSurface({
	startMs,
	endMs,
	seekOnClick = false,
	children,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onPointerCancel,
	onClick,
	onKeyDown,
	onBlur,
	...props
}: SelectionSurfaceProps) {
	const playback = useWorkspacePlayback();
	const anchorRef = useRef<number | null>(null);
	const keyboardGestureRef = useRef<SelectionGesture | null>(null);
	const wasSelectingRef = useRef(false);
	const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
	const durationMs = Math.max(playback.durationSec * 1000, endMs);
	const span = endMs - startMs;
	const selection = draft ?? playback.selection;
	const timeAt = (element: HTMLDivElement, clientX: number): number => {
		const rect = element.getBoundingClientRect();
		const fraction = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;

		return startMs + fraction * span;
	};

	return (
		<div
			role="slider"
			tabIndex={0}
			aria-label="Time selection"
			aria-valuemin={startMs}
			aria-valuemax={endMs}
			aria-valuenow={Math.max(startMs, Math.min(endMs, selection?.end ?? playback.positionSec * 1000))}
			title="Shift-drag to select a range. Escape clears the selection."
			{...props}
			onPointerDown={(event) => {
				if (event.defaultPrevented || isNestedSelectionControl(event.target, event.currentTarget)) return;

				wasSelectingRef.current = false;
				keyboardGestureRef.current = null;

				if (event.shiftKey && event.button === 0 && span > 0) {
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.focus({ preventScroll: true });
					event.currentTarget.setPointerCapture(event.pointerId);
					anchorRef.current = timeAt(event.currentTarget, event.clientX);
					wasSelectingRef.current = true;
					setDraft({ start: anchorRef.current, end: anchorRef.current });

					return;
				}

				onPointerDown?.(event);
			}}
			onPointerMove={(event) => {
				const anchor = anchorRef.current;

				if (anchor !== null) {
					const time = timeAt(event.currentTarget, event.clientX);

					setDraft({ start: Math.min(anchor, time), end: Math.max(anchor, time) });
				}

				onPointerMove?.(event);
			}}
			onPointerUp={(event) => {
				const anchor = anchorRef.current;

				if (anchor !== null) {
					const active = timeAt(event.currentTarget, event.clientX);
					const selected = normalizeSelection(anchor, active, durationMs);

					keyboardGestureRef.current = { anchor, active, selection: selected };
					playback.onSelectionChange(selected);
					anchorRef.current = null;
					setDraft(null);

					if (event.currentTarget.hasPointerCapture(event.pointerId))
						event.currentTarget.releasePointerCapture(event.pointerId);
				}

				onPointerUp?.(event);
			}}
			onPointerCancel={(event) => {
				anchorRef.current = null;
				setDraft(null);
				onPointerCancel?.(event);
			}}
			onClick={(event) => {
				if (event.defaultPrevented || isNestedSelectionControl(event.target, event.currentTarget)) return;

				if (wasSelectingRef.current) {
					wasSelectingRef.current = false;
					event.stopPropagation();

					return;
				}

				if (seekOnClick && !event.shiftKey) {
					keyboardGestureRef.current = null;
					playback.onSeek(timeAt(event.currentTarget, event.clientX) / 1000);
				}

				onClick?.(event);
			}}
			onKeyDown={(event) => {
				if (event.defaultPrevented || isNestedSelectionControl(event.target, event.currentTarget)) return;

				if (event.key === "Escape") {
					playback.onSelectionChange(null);
					setDraft(null);
					anchorRef.current = null;
					keyboardGestureRef.current = null;
					event.preventDefault();
					event.stopPropagation();

					return;
				}

				if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
					const gesture = extendSelection(
						keyboardGestureRef.current,
						playback.selection,
						playback.positionSec * 1000,
						((event.key === "ArrowRight" ? 1 : -1) * span) / 100,
						durationMs,
					);

					keyboardGestureRef.current = gesture;
					playback.onSelectionChange(gesture.selection);
					event.preventDefault();
					event.stopPropagation();

					return;
				}

				if (seekOnClick && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
					const step = span / 100;
					const positionMs = playback.positionSec * 1000;
					const seekMs =
						event.key === "ArrowLeft"
							? positionMs - step
							: event.key === "ArrowRight"
								? positionMs + step
								: event.key === "Home" || event.key === "Enter" || event.key === " "
									? startMs
									: event.key === "End"
										? endMs
										: null;

					if (seekMs !== null) {
						keyboardGestureRef.current = null;
						playback.onSeek(Math.max(startMs, Math.min(endMs, seekMs)) / 1000);
						event.preventDefault();
						event.stopPropagation();

						return;
					}
				}

				onKeyDown?.(event);
			}}
			onBlur={(event) => {
				keyboardGestureRef.current = null;
				onBlur?.(event);
			}}
		>
			{children}
			{selection && span > 0 && selection.end > startMs && selection.start < endMs && (
				<Selection
					startFraction={Math.max(0, (selection.start - startMs) / span)}
					endFraction={Math.min(1, (selection.end - startMs) / span)}
				/>
			)}
		</div>
	);
}
