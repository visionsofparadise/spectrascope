import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../cn";
import { constrainAxisRange, FULL_AXIS_RANGE, panAxisRange, resizeAxisRange, zoomAxisRange } from "../utils/axisRange";
import type { AxisRange } from "../utils/axisRange";

type TrackPart = "pan" | "start" | "end";

export interface ScrollTrackProps {
	readonly axis: "x" | "y";
	readonly range: AxisRange;
	readonly minSpan: number;
	readonly label: string;
	readonly valueText: string;
	readonly edgeLabels: readonly [string, string];
	readonly edgeValueTexts: readonly [string, string];
	readonly onRangeChange: (range: AxisRange) => void;
	readonly className?: string;
}

const EDGES = ["start", "end"] as const;
const EDGE_LENGTH_PX = 3;
const THUMB_MIN_LENGTH_PX = 6;

function thumbPlacementOf(range: AxisRange): { readonly offset: string; readonly length: string } {
	const length = `max(${(range.end - range.start) * 100}%, ${THUMB_MIN_LENGTH_PX}px)`;
	const center = ((range.start + range.end) / 2) * 100;

	return { offset: `clamp(0px, calc(${center}% - ${length} / 2), calc(100% - ${length}))`, length };
}

export function ScrollTrack({
	axis,
	range: requestedRange,
	minSpan,
	label,
	valueText,
	edgeLabels,
	edgeValueTexts,
	onRangeChange,
	className,
}: ScrollTrackProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const range = constrainAxisRange(requestedRange, minSpan);
	const rangeRef = useRef(range);
	const changeRef = useRef(onRangeChange);
	const dragRef = useRef<{ readonly part: TrackPart; readonly origin: number; readonly range: AxisRange } | null>(
		null,
	);
	const [trackLength, setTrackLength] = useState(0);
	const [draggedPart, setDraggedPart] = useState<TrackPart | null>(null);

	rangeRef.current = range;
	changeRef.current = onRangeChange;

	const commit = useCallback((next: AxisRange) => {
		rangeRef.current = next;
		changeRef.current(next);
	}, []);

	const fractionOf = useCallback(
		(point: { readonly clientX: number; readonly clientY: number }) => {
			const rect = containerRef.current?.getBoundingClientRect();

			if (!rect) return 0;

			const length = axis === "x" ? rect.width : rect.height;
			const offset = axis === "x" ? point.clientX - rect.left : point.clientY - rect.top;

			return length > 0 ? Math.max(0, Math.min(1, offset / length)) : 0;
		},
		[axis],
	);

	useEffect(() => {
		const element = containerRef.current;

		if (!element) return;

		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			event.stopPropagation();
			commit(zoomAxisRange(rangeRef.current, Math.exp(event.deltaY * 0.002), fractionOf(event), minSpan));
		};

		element.addEventListener("wheel", wheel, { passive: false });

		return () => element.removeEventListener("wheel", wheel);
	}, [commit, fractionOf, minSpan]);

	useEffect(() => {
		const element = containerRef.current;

		if (!element) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];

			if (!entry) return;

			setTrackLength(axis === "x" ? entry.contentRect.width : entry.contentRect.height);
		});

		observer.observe(element);

		return () => observer.disconnect();
	}, [axis]);

	const pointerDown = (event: React.PointerEvent<HTMLButtonElement>, part: TrackPart) => {
		if (event.button !== 0) return;

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { part, origin: fractionOf(event), range: rangeRef.current };
		setDraggedPart(part);
	};
	const pointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragRef.current;

		if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

		const fraction = fractionOf(event);

		commit(
			drag.part === "pan"
				? panAxisRange(drag.range, fraction - drag.origin, minSpan)
				: resizeAxisRange(drag.range, drag.part, fraction, minSpan),
		);
	};
	const pointerEnd = () => {
		dragRef.current = null;
		setDraggedPart(null);
	};
	const nextRangeOf = (current: AxisRange, key: string, shiftKey: boolean, part: TrackPart): AxisRange | undefined => {
		const step = (current.end - current.start) / (shiftKey ? 100 : 10);
		const [backKey, forwardKey] = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
		const moved = (delta: number) =>
			part === "pan"
				? panAxisRange(current, delta, minSpan)
				: resizeAxisRange(current, part, current[part] + delta, minSpan);

		if (key === backKey) return moved(-step);

		if (key === forwardKey) return moved(step);

		if (key === "PageUp") return moved(-step * 5);

		if (key === "PageDown") return moved(step * 5);

		if (key === "Home")
			return part === "pan"
				? panAxisRange(current, -1, minSpan)
				: resizeAxisRange(current, part, part === "start" ? 0 : current.start + minSpan, minSpan);

		if (key === "End")
			return part === "pan"
				? panAxisRange(current, 1, minSpan)
				: resizeAxisRange(current, part, part === "end" ? 1 : current.end - minSpan, minSpan);

		if (key === "+" || key === "=") return zoomAxisRange(current, 0.8, (current.start + current.end) / 2, minSpan);

		if (key === "-") return zoomAxisRange(current, 1.25, (current.start + current.end) / 2, minSpan);

		if (key === "Escape" || key === "0") return FULL_AXIS_RANGE;

		return undefined;
	};
	const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>, part: TrackPart) => {
		const next = nextRangeOf(rangeRef.current, event.key, event.shiftKey, part);

		if (!next) return;

		event.preventDefault();
		event.stopPropagation();
		commit(next);
	};
	const handlersOf = (part: TrackPart) => ({
		onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => pointerDown(event, part),
		onPointerMove: pointerMove,
		onPointerUp: pointerEnd,
		onPointerCancel: pointerEnd,
		onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => keyDown(event, part),
		onDoubleClick: () => commit(FULL_AXIS_RANGE),
	});
	const horizontal = axis === "x";
	const orientation = horizontal ? "horizontal" : "vertical";
	const focusClass = "outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary";
	const thumb = thumbPlacementOf(range);
	const compact = trackLength > 0 && (range.end - range.start) * trackLength < EDGE_LENGTH_PX * 3;

	return (
		<div
			ref={containerRef}
			className={cn(
				"relative touch-none select-none overflow-hidden bg-void",
				horizontal ? "h-3" : "w-3",
				className,
			)}
		>
			<button
				type="button"
				role="slider"
				aria-label={label}
				aria-orientation={orientation}
				aria-valuemin={0}
				aria-valuemax={1}
				aria-valuenow={(range.start + range.end) / 2}
				aria-valuetext={valueText}
				{...handlersOf("pan")}
				className={cn(
					"absolute bg-chrome-raised",
					horizontal ? "inset-y-0 h-full" : "inset-x-0 w-full",
					focusClass,
				)}
				style={
					horizontal ? { left: thumb.offset, width: thumb.length } : { top: thumb.offset, height: thumb.length }
				}
			/>
			{EDGES.map(
				(edge, index) =>
					(!compact || draggedPart === edge) && (
						<button
							key={edge}
							type="button"
							role="slider"
							aria-label={edgeLabels[index]}
							aria-orientation={orientation}
							aria-valuemin={0}
							aria-valuemax={1}
							aria-valuenow={range[edge]}
							aria-valuetext={edgeValueTexts[index]}
							{...handlersOf(edge)}
							className={cn(
								"absolute bg-transparent",
								horizontal
									? "inset-y-0 h-full w-[3px] cursor-ew-resize"
									: "inset-x-0 h-[3px] w-full cursor-ns-resize",
								focusClass,
							)}
							style={
								horizontal
									? {
											left: `${range[edge] * 100}%`,
											transform: edge === "end" ? "translateX(-100%)" : undefined,
										}
									: {
											top: `${range[edge] * 100}%`,
											transform: edge === "end" ? "translateY(-100%)" : undefined,
										}
							}
						/>
					),
			)}
		</div>
	);
}
