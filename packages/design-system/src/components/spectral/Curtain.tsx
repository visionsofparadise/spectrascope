import { useCallback, useEffect, useRef } from "react";
import { cn } from "../../cn";

interface CurtainProps {
  /** Current curtain position as a fraction of the parent rect width, in [min, max]. */
  readonly position: number;
  readonly onPositionChange: (next: number) => void;
  /** Lower bound for `position` (default 0). */
  readonly min?: number;
  /** Upper bound for `position` (default 1). */
  readonly max?: number;
  readonly className?: string;
}

/**
 * Visual Curtain primitive — a draggable vertical line that splits a layered
 * display along the time axis. The component is purely visual + interactive:
 * it reports its position in [min, max] as a fraction of the parent rect width,
 * and the consumer maps that to "which layer is active on each side."
 *
 * Audio-playback switching at the curtain is *not* wired in the first pass;
 * the consumer is responsible for any clip-path / blend-mode composition that
 * makes the split visually correct.
 */
export function Curtain({ position, onPositionChange, min = 0, max = 1, className }: CurtainProps) {
  const lineRef = useRef<HTMLDivElement>(null);
  // Latest min/max/onChange captured for use inside global pointer listeners.
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const onChangeRef = useRef(onPositionChange);

  useEffect(() => { minRef.current = min; }, [min]);
  useEffect(() => { maxRef.current = max; }, [max]);
  useEffect(() => { onChangeRef.current = onPositionChange; }, [onPositionChange]);

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

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const onMove = (moveEvent: PointerEvent) => {
      updateFromClientX(moveEvent.clientX);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    // Snap to the click location immediately.
    updateFromClientX(event.clientX);
  }, [updateFromClientX]);

  const percent = `${position * 100}%`;

  return (
    <div
      ref={lineRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-y-0", className)}
      style={{ left: percent, transform: "translateX(-1px)" }}
    >
      {/* Vertical 2px line spanning the parent's full height */}
      <div
        className="absolute inset-y-0 w-0.5 bg-chrome-text"
        aria-hidden
      />
      {/* Draggable handle — centered vertically. The chip is the eye-catching
          target; the two interior bars provide a grip motif so the affordance
          reads as a draggable handle rather than a tooltip. */}
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
