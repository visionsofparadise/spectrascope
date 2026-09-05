import { useCallback } from "react";
import { eventToTime } from "../views/viewCursor";

interface CursorSurfaceProps {
	readonly startMs: number;
	readonly endMs: number;
	readonly cursorMs: number | null;
	readonly onCursorChange: (ms: number) => void;
	readonly surfaceRef?: React.RefObject<HTMLDivElement | null>;
	readonly className?: string;
	readonly children?: React.ReactNode;
}

const KEYBOARD_STEP_FRACTION = 0.01;

export function CursorSurface({
	startMs,
	endMs,
	cursorMs,
	onCursorChange,
	surfaceRef,
	className,
	children,
}: CursorSurfaceProps) {
	const handleClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const time = eventToTime(event, startMs, endMs);

			if (time !== null) onCursorChange(time);
		},
		[onCursorChange, startMs, endMs],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			const span = endMs - startMs;

			if (span <= 0) return;

			const from = cursorMs ?? startMs;
			const step = span * KEYBOARD_STEP_FRACTION;

			let time: number | null = null;

			if (event.key === "ArrowLeft" || event.key === "ArrowDown") time = Math.max(startMs, from - step);
			else if (event.key === "ArrowRight" || event.key === "ArrowUp") time = Math.min(endMs, from + step);
			else if (event.key === "Home") time = startMs;
			else if (event.key === "End") time = endMs;

			if (time === null) return;

			event.preventDefault();
			onCursorChange(time);
		},
		[cursorMs, onCursorChange, startMs, endMs],
	);

	return (
		<div
			ref={surfaceRef}
			className={className}
			role="slider"
			tabIndex={0}
			aria-label="Inspection cursor"
			aria-valuemin={startMs}
			aria-valuemax={endMs}
			aria-valuenow={cursorMs ?? startMs}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
		>
			{children}
		</div>
	);
}
