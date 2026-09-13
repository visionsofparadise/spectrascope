import { useCallback, useEffect, useRef } from "react";
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

	rangeRef.current = range;
	changeRef.current = onRangeChange;

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
			changeRef.current(zoomAxisRange(rangeRef.current, Math.exp(event.deltaY * 0.002), fractionOf(event), minSpan));
		};

		element.addEventListener("wheel", wheel, { passive: false });

		return () => element.removeEventListener("wheel", wheel);
	}, [fractionOf, minSpan]);

	const pointerDown = (event: React.PointerEvent<HTMLButtonElement>, part: TrackPart) => {
		if (event.button !== 0) return;

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { part, origin: fractionOf(event), range: rangeRef.current };
	};
	const pointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragRef.current;

		if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

		const fraction = fractionOf(event);

		onRangeChange(
			drag.part === "pan"
				? panAxisRange(drag.range, fraction - drag.origin, minSpan)
				: resizeAxisRange(drag.range, drag.part, fraction, minSpan),
		);
	};
	const pointerEnd = () => {
		dragRef.current = null;
	};
	const movedRangeOf = (part: TrackPart, delta: number) =>
		part === "pan" ? panAxisRange(range, delta, minSpan) : resizeAxisRange(range, part, range[part] + delta, minSpan);
	const nextRangeOf = (key: string, shiftKey: boolean, part: TrackPart): AxisRange | undefined => {
		const step = (range.end - range.start) / (shiftKey ? 100 : 10);
		const [backKey, forwardKey] = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];

		if (key === backKey) return movedRangeOf(part, -step);

		if (key === forwardKey) return movedRangeOf(part, step);

		if (key === "PageUp") return movedRangeOf(part, -step * 5);

		if (key === "PageDown") return movedRangeOf(part, step * 5);

		if (key === "Home")
			return part === "pan"
				? panAxisRange(range, -1, minSpan)
				: resizeAxisRange(range, part, part === "start" ? 0 : range.start + minSpan, minSpan);

		if (key === "End")
			return part === "pan"
				? panAxisRange(range, 1, minSpan)
				: resizeAxisRange(range, part, part === "end" ? 1 : range.end - minSpan, minSpan);

		if (key === "+" || key === "=") return zoomAxisRange(range, 0.8, (range.start + range.end) / 2, minSpan);

		if (key === "-") return zoomAxisRange(range, 1.25, (range.start + range.end) / 2, minSpan);

		if (key === "Escape" || key === "0") return FULL_AXIS_RANGE;

		return undefined;
	};
	const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>, part: TrackPart) => {
		const next = nextRangeOf(event.key, event.shiftKey, part);

		if (!next) return;

		event.preventDefault();
		event.stopPropagation();
		onRangeChange(next);
	};
	const handlersOf = (part: TrackPart) => ({
		onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => pointerDown(event, part),
		onPointerMove: pointerMove,
		onPointerUp: pointerEnd,
		onPointerCancel: pointerEnd,
		onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => keyDown(event, part),
		onDoubleClick: () => onRangeChange(FULL_AXIS_RANGE),
	});
	const horizontal = axis === "x";
	const orientation = horizontal ? "horizontal" : "vertical";
	const focusClass = "outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary";

	return (
		<div
			ref={containerRef}
			className={cn(
				"relative touch-none select-none overflow-hidden bg-void",
				horizontal ? "h-2" : "w-2",
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
				className={cn("absolute bg-chrome-raised", horizontal ? "inset-y-0" : "inset-x-0", focusClass)}
				style={
					horizontal
						? { left: `${range.start * 100}%`, width: `${(range.end - range.start) * 100}%` }
						: { top: `${range.start * 100}%`, height: `${(range.end - range.start) * 100}%` }
				}
			/>
			{EDGES.map((edge, index) => (
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
						horizontal ? "inset-y-0 w-[3px] cursor-ew-resize" : "inset-x-0 h-[3px] cursor-ns-resize",
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
			))}
		</div>
	);
}
