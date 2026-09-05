export function trackPointerDrag(onMove: (clientX: number) => void, onEnd?: (clientX: number) => void): void {
	const handleMove = (event: PointerEvent) => {
		onMove(event.clientX);
	};

	const handleEnd = (event: PointerEvent) => {
		onEnd?.(event.clientX);
		window.removeEventListener("pointermove", handleMove);
		window.removeEventListener("pointerup", handleEnd);
		window.removeEventListener("pointercancel", handleEnd);
	};

	window.addEventListener("pointermove", handleMove);
	window.addEventListener("pointerup", handleEnd);
	window.addEventListener("pointercancel", handleEnd);
}
