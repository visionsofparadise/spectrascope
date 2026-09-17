import { batch } from "opshot";
import { scope } from "opshot/react";
import { useRef, useState } from "react";
import { cn } from "../../cn";
import { selectRange } from "../../session/utils/documentWrites";
import { createGestureKey } from "../../utils/gestureKey";
import { extendSelection, isNestedSelectionControl, normalizeSelection } from "../utils/selection";
import { Playhead } from "./Playhead";
import { Selection } from "./Selection";
import { useSessionSelection } from "./useSessionSelection";
import type { SessionContext } from "../../models/Context";
import type { SelectionGesture } from "../utils/selection";
import type { ComponentProps } from "react";

interface SelectionSurfaceProps extends ComponentProps<"div"> {
	readonly startMs: number;
	readonly endMs: number;
	readonly seekOnClick?: boolean;
	readonly context: SessionContext;
}

export const SelectionSurface = scope<SelectionSurfaceProps>(
	({
		startMs,
		endMs,
		seekOnClick = true,
		children,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		onLostPointerCapture,
		onClick,
		onKeyDown,
		onKeyUp,
		onBlur,
		context,
		...props
	}: SelectionSurfaceProps) => {
		const { playback, playbackControls, sessionDurationMs } = context;
		const [extendKey] = useState(createGestureKey);
		const gestureRef = useRef<{ pointerId: number; clientX: number; anchor: number; dragging: boolean } | null>(null);
		const keyboardGestureRef = useRef<SelectionGesture | null>(null);
		const wasSelectingRef = useRef(false);
		const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
		const durationMs = Math.max(Math.max(playback.durationSec, sessionDurationMs / 1000) * 1000, endMs);
		const span = endMs - startMs;
		const sessionSelection = useSessionSelection(context);
		const selection = draft ?? sessionSelection;
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
				title="Click to seek. Drag to select a loop. Escape clears the selection."
				{...props}
				className={cn("outline-none", props.className)}
				style={{ ...props.style, touchAction: "none", userSelect: "none" }}
				onPointerDown={(event) => {
					if (event.defaultPrevented || isNestedSelectionControl(event.target, event.currentTarget)) return;

					wasSelectingRef.current = false;
					keyboardGestureRef.current = null;

					if (event.button === 0 && event.isPrimary && span > 0 && !gestureRef.current) {
						event.preventDefault();
						event.stopPropagation();
						event.currentTarget.focus({ preventScroll: true });
						event.currentTarget.setPointerCapture(event.pointerId);
						gestureRef.current = {
							pointerId: event.pointerId,
							clientX: event.clientX,
							anchor: timeAt(event.currentTarget, event.clientX),
							dragging: false,
						};

						return;
					}

					onPointerDown?.(event);
				}}
				onPointerMove={(event) => {
					const gesture = gestureRef.current;

					if (gesture?.pointerId === event.pointerId) {
						const time = timeAt(event.currentTarget, event.clientX);

						gesture.dragging ||= Math.abs(event.clientX - gesture.clientX) > 3;

						if (gesture.dragging) {
							wasSelectingRef.current = true;
							setDraft({ start: Math.min(gesture.anchor, time), end: Math.max(gesture.anchor, time) });
						}
					}

					onPointerMove?.(event);
				}}
				onPointerUp={(event) => {
					const gesture = gestureRef.current;

					if (gesture?.pointerId === event.pointerId) {
						if (gesture.dragging || Math.abs(event.clientX - gesture.clientX) > 3) {
							const active = timeAt(event.currentTarget, event.clientX);
							const selected = normalizeSelection(gesture.anchor, active, durationMs);

							wasSelectingRef.current = true;
							keyboardGestureRef.current = { anchor: gesture.anchor, active, selection: selected };
							selectRange(selected, sessionDurationMs, context);
						}

						gestureRef.current = null;
						setDraft(null);

						if (event.currentTarget.hasPointerCapture(event.pointerId))
							event.currentTarget.releasePointerCapture(event.pointerId);
					}

					onPointerUp?.(event);
				}}
				onPointerCancel={(event) => {
					if (gestureRef.current?.pointerId === event.pointerId) {
						gestureRef.current = null;
						wasSelectingRef.current = true;
						setDraft(null);

						if (event.currentTarget.hasPointerCapture(event.pointerId))
							event.currentTarget.releasePointerCapture(event.pointerId);
					}

					onPointerCancel?.(event);
				}}
				onLostPointerCapture={(event) => {
					if (gestureRef.current?.pointerId === event.pointerId) {
						gestureRef.current = null;
						wasSelectingRef.current = true;
						setDraft(null);
					}

					onLostPointerCapture?.(event);
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
						selectRange(null, sessionDurationMs, context);
						playbackControls.onSeek(timeAt(event.currentTarget, event.clientX) / 1000);
					}

					onClick?.(event);
				}}
				onKeyDown={(event) => {
					if (event.defaultPrevented || isNestedSelectionControl(event.target, event.currentTarget)) return;

					if (event.key === "Escape") {
						selectRange(null, sessionDurationMs, context);
						setDraft(null);

						const gesture = gestureRef.current;

						gestureRef.current = null;

						if (gesture && event.currentTarget.hasPointerCapture(gesture.pointerId)) {
							wasSelectingRef.current = true;
							event.currentTarget.releasePointerCapture(gesture.pointerId);
						}

						keyboardGestureRef.current = null;
						event.preventDefault();
						event.stopPropagation();

						return;
					}

					if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
						const gesture = extendSelection(
							keyboardGestureRef.current,
							sessionSelection,
							playback.positionSec * 1000,
							((event.key === "ArrowRight" ? 1 : -1) * span) / 100,
							durationMs,
						);

						keyboardGestureRef.current = gesture;
						batch(() => selectRange(gesture.selection, sessionDurationMs, context), extendKey.current());
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
							playbackControls.onSeek(Math.max(startMs, Math.min(endMs, seekMs)) / 1000);
							event.preventDefault();
							event.stopPropagation();

							return;
						}
					}

					onKeyDown?.(event);
				}}
				onKeyUp={(event) => {
					extendKey.end();
					onKeyUp?.(event);
				}}
				onBlur={(event) => {
					keyboardGestureRef.current = null;
					extendKey.end();
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
				<Playhead startMs={startMs} endMs={endMs} context={context} />
			</div>
		);
	},
);
