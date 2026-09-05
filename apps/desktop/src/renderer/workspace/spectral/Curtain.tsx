import { useCallback, useEffect, useRef } from "react";
import { cn } from "../../cn";
import { trackPointerDrag } from "./pointerDrag";

interface CurtainProps {
	readonly position: number;
	readonly onPositionChange: (next: number) => void;
	readonly min?: number;
	readonly max?: number;
	readonly className?: string;
}

export function Curtain({ position, onPositionChange, min = 0, max = 1, className }: CurtainProps) {
	const lineRef = useRef<HTMLDivElement>(null);
	const minRef = useRef(min);
	const maxRef = useRef(max);
	const onChangeRef = useRef(onPositionChange);

	useEffect(() => {
		minRef.current = min;
	}, [min]);
	useEffect(() => {
		maxRef.current = max;
	}, [max]);
	useEffect(() => {
		onChangeRef.current = onPositionChange;
	}, [onPositionChange]);

	const updateFromClientX = useCallback((clientX: number) => {
		const element = lineRef.current?.parentElement;

		if (!element) return;

		const rect = element.getBoundingClientRect();

		if (rect.width <= 0) return;

		const raw = (clientX - rect.left) / rect.width;
		const lo = minRef.current;
		const hi = maxRef.current;
		const clamped = Math.min(hi, Math.max(lo, raw));

		onChangeRef.current(clamped);
	}, []);

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			event.preventDefault();
			event.stopPropagation();

			trackPointerDrag(updateFromClientX);

			updateFromClientX(event.clientX);
		},
		[updateFromClientX],
	);

	const percent = `${position * 100}%`;

	return (
		<div
			ref={lineRef}
			aria-hidden
			className={cn("pointer-events-none absolute inset-y-0", className)}
			style={{ left: percent, transform: "translateX(-1px)" }}
		>
			<div className="absolute inset-y-0 w-0.5 bg-chrome-text" aria-hidden />
			<button
				type="button"
				onPointerDown={handlePointerDown}
				aria-label="Curtain position"
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={position}
				role="slider"
				className="pointer-events-auto absolute top-1/2 left-1/2 flex h-6 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center gap-0.5 bg-chrome-text outline-none hover:bg-primary focus-visible:bg-primary focus-visible:ring-1 focus-visible:ring-primary"
			>
				<span aria-hidden className="block h-3 w-px bg-void/60" />
				<span aria-hidden className="block h-3 w-px bg-void/60" />
			</button>
		</div>
	);
}
