import { useRef, useEffect, useCallback } from "react";
import { SpectrogramCanvas } from "spectral-display";
import {
	constrainFrequencyRange,
	FULL_FREQUENCY_RANGE,
	MIN_FREQUENCY_SPAN,
	panFrequencyRange,
	resizeFrequencyRange,
	zoomFrequencyRange,
} from "../utils/frequencyRange";
import { fractionToFrequency } from "../utils/frequencyScale";
import type { FrequencyScale } from "spectral-display";
import type { ComputeResultReady, TextureVerticalRange } from "spectral-display";

interface FrequencyMinimapProps {
	readonly amplitude?: boolean;
	readonly sampleRate: number;
	readonly computeResult: ComputeResultReady | null;
	readonly frequencyScale?: FrequencyScale;
	readonly frequencyRange: TextureVerticalRange;
	readonly onFrequencyRangeChange: (range: TextureVerticalRange) => void;
}

export function FrequencyMinimap({
	amplitude = false,
	sampleRate,
	computeResult,
	frequencyScale = "mel",
	frequencyRange,
	onFrequencyRangeChange,
}: FrequencyMinimapProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const range = constrainFrequencyRange(frequencyRange);
	const rangeRef = useRef(range);
	const changeRef = useRef(onFrequencyRangeChange);

	rangeRef.current = range;
	changeRef.current = onFrequencyRangeChange;

	const dragRef = useRef<{ mode: "pan" | "top" | "bottom"; start: number; range: TextureVerticalRange } | null>(null);
	const fractionOf = useCallback((clientY: number) => {
		const rect = containerRef.current?.getBoundingClientRect();

		return rect && rect.height > 0 ? Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) : 0;
	}, []);

	useEffect(() => {
		const element = containerRef.current;

		if (!element) return;

		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			event.stopPropagation();
			changeRef.current(
				zoomFrequencyRange(rangeRef.current, Math.exp(event.deltaY * 0.002), fractionOf(event.clientY)),
			);
		};

		element.addEventListener("wheel", wheel, { passive: false });

		return () => element.removeEventListener("wheel", wheel);
	}, [fractionOf]);

	const pointerDown = (event: React.PointerEvent<HTMLButtonElement>, mode: "pan" | "top" | "bottom") => {
		if (event.button !== 0) return;

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { mode, start: fractionOf(event.clientY), range: rangeRef.current };
	};
	const pointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragRef.current;

		if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

		const fraction = fractionOf(event.clientY);

		onFrequencyRangeChange(
			drag.mode === "pan"
				? panFrequencyRange(drag.range, fraction - drag.start)
				: resizeFrequencyRange(drag.range, drag.mode, fraction),
		);
	};
	const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>, mode: "pan" | "top" | "bottom") => {
		const step = (range.bottom - range.top) / (event.shiftKey ? 100 : 10);
		let next: TextureVerticalRange | undefined;
		const delta =
			event.key === "ArrowUp"
				? -step
				: event.key === "ArrowDown"
					? step
					: event.key === "PageUp"
						? -step * 5
						: event.key === "PageDown"
							? step * 5
							: 0;

		if (delta)
			next =
				mode === "pan" ? panFrequencyRange(range, delta) : resizeFrequencyRange(range, mode, range[mode] + delta);
		else if (event.key === "Home")
			next =
				mode === "pan"
					? panFrequencyRange(range, -1)
					: resizeFrequencyRange(range, mode, mode === "top" ? 0 : range.top + MIN_FREQUENCY_SPAN);
		else if (event.key === "End")
			next =
				mode === "pan"
					? panFrequencyRange(range, 1)
					: resizeFrequencyRange(range, mode, mode === "bottom" ? 1 : range.bottom - MIN_FREQUENCY_SPAN);
		else if (event.key === "+" || event.key === "=")
			next = zoomFrequencyRange(range, 0.8, (range.top + range.bottom) / 2);
		else if (event.key === "-") next = zoomFrequencyRange(range, 1.25, (range.top + range.bottom) / 2);
		else if (event.key === "Escape" || event.key === "0") next = FULL_FREQUENCY_RANGE;

		if (next) {
			event.preventDefault();
			event.stopPropagation();
			onFrequencyRangeChange(next);
		}
	};
	const renderable =
		!amplitude && computeResult?.options.config.frequencyScale === frequencyScale ? computeResult : null;
	const amplitudeOf = (fraction: number) => Number((1 - 2 * fraction).toFixed(3));
	const label = amplitude
		? `${amplitudeOf(range.bottom)} to ${amplitudeOf(range.top)} FS`
		: `${Math.round(fractionToFrequency(range.bottom, sampleRate, undefined, frequencyScale))} to ${Math.round(fractionToFrequency(range.top, sampleRate, undefined, frequencyScale))} Hz`;

	return (
		<div ref={containerRef} className="relative w-8 bg-void">
			{renderable !== null && (
				<div className="pointer-events-none absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
					<SpectrogramCanvas computeResult={renderable} />
				</div>
			)}
			<div
				className="pointer-events-none absolute inset-x-0 top-0 bg-black/65"
				style={{ height: `${range.top * 100}%` }}
			/>
			<div
				className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/65"
				style={{ height: `${(1 - range.bottom) * 100}%` }}
			/>
			<button
				type="button"
				role="slider"
				aria-label={amplitude ? "Amplitude range" : "Frequency range"}
				aria-orientation="vertical"
				aria-valuemin={0}
				aria-valuemax={1}
				aria-valuenow={(range.top + range.bottom) / 2}
				aria-valuetext={label}
				onPointerDown={(event) => pointerDown(event, "pan")}
				onPointerMove={pointerMove}
				onPointerUp={() => {
					dragRef.current = null;
				}}
				onPointerCancel={() => {
					dragRef.current = null;
				}}
				onKeyDown={(event) => keyDown(event, "pan")}
				onDoubleClick={() => onFrequencyRangeChange(FULL_FREQUENCY_RANGE)}
				className="absolute inset-x-0 cursor-ns-resize border border-data-selection-border bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-primary"
				style={{ top: `${range.top * 100}%`, height: `${(range.bottom - range.top) * 100}%` }}
			/>
			{(["top", "bottom"] as const).map((edge) => (
				<button
					key={edge}
					type="button"
					role="slider"
					aria-label={`${edge === "top" ? "Upper" : "Lower"} ${amplitude ? "amplitude" : "frequency"} limit`}
					aria-orientation="vertical"
					aria-valuemin={0}
					aria-valuemax={1}
					aria-valuenow={range[edge]}
					aria-valuetext={
						amplitude
							? `${amplitudeOf(range[edge])} FS`
							: `${Math.round(fractionToFrequency(range[edge], sampleRate, undefined, frequencyScale))} Hz`
					}
					onPointerDown={(event) => pointerDown(event, edge)}
					onPointerMove={pointerMove}
					onPointerUp={() => {
						dragRef.current = null;
					}}
					onPointerCancel={() => {
						dragRef.current = null;
					}}
					onKeyDown={(event) => keyDown(event, edge)}
					className="absolute inset-x-0 h-2 cursor-ns-resize bg-data-selection-border/70 outline-none focus-visible:ring-1 focus-visible:ring-primary"
					style={{ top: `${range[edge] * 100}%`, transform: edge === "bottom" ? "translateY(-100%)" : undefined }}
				/>
			))}
			<button
				type="button"
				aria-label={amplitude ? "Reset amplitude range" : "Reset frequency range"}
				title={amplitude ? "Reset amplitude range" : "Reset frequency range"}
				onClick={() => onFrequencyRangeChange(FULL_FREQUENCY_RANGE)}
				className="absolute right-0 top-1/2 bg-void/80 px-1 font-technical text-xs text-chrome-text-secondary hover:text-primary"
			>
				↕
			</button>
		</div>
	);
}
