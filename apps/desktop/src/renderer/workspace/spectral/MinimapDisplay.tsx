import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WaveformCanvas, useSpectralCompute } from "spectral-display";
import { ComputeProgress } from "./ComputeProgress";
import type { AudioData } from "./types";
import type { SpectralOptions } from "spectral-display";

interface MinimapDisplayProps {
	readonly audioData: AudioData;
	/** Left edge of the viewport bracket as a fraction of the full duration (0..1). */
	readonly viewStartFrac: number;
	/** Right edge of the viewport bracket as a fraction of the full duration (0..1). */
	readonly viewEndFrac: number;
	/** Waveform RGB color (0..255 per channel) — see SourceRender.hexToRgb255. */
	readonly waveformColor: readonly [number, number, number];
	/**
	 * Click / drag on the strip reports the pointer's `[0, 1]` fraction of the
	 * full duration. The view recentres its viewport window on that fraction.
	 * Omitted by the trace views that render a whole-clip minimap.
	 */
	readonly onScrubToFraction?: (fraction: number) => void;
}

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): {
	width: number;
	height: number;
} {
	const [size, setSize] = useState({ width: 800, height: 48 });

	useEffect(() => {
		const element = ref.current;

		if (!element) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];

			if (!entry) return;

			setSize({
				width: Math.round(entry.contentRect.width),
				height: Math.round(entry.contentRect.height),
			});
		});

		observer.observe(element);

		return () => {
			observer.disconnect();
		};
	}, [ref]);

	return size;
}

/**
 * Horizontal overview strip — renders the full audio waveform at minimap
 * resolution, with the visible viewport region bracketed and the surrounding
 * area dimmed. Pair with `FrequencyMinimap` (vertical) to give the user a
 * 2D zoom/pan overview of the source.
 *
 * Ported from the pre-deletion SpectralPage `MinimapDisplay`
 * (`archive/spectralpage-reference.tsx` lines ~276-323), generalised to take
 * the viewport fractions as props rather than reading module constants.
 */
export function MinimapDisplay({
	audioData,
	viewStartFrac,
	viewEndFrac,
	waveformColor,
	onScrubToFraction,
}: MinimapDisplayProps) {
	const minimapRef = useRef<HTMLDivElement>(null);
	const { width, height } = useContainerSize(minimapRef);

	// Pointer scrub — reports the pointer's fraction of the full duration on
	// press and while dragging (pointer capture keeps the drag alive off-strip).
	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!onScrubToFraction) return;

			const rect = event.currentTarget.getBoundingClientRect();

			if (rect.width <= 0) return;

			event.currentTarget.setPointerCapture(event.pointerId);

			const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));

			onScrubToFraction(fraction);
		},
		[onScrubToFraction],
	);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!onScrubToFraction || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

			const rect = event.currentTarget.getBoundingClientRect();

			if (rect.width <= 0) return;

			const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));

			onScrubToFraction(fraction);
		},
		[onScrubToFraction],
	);

	const color = useMemo<[number, number, number]>(
		() => [waveformColor[0], waveformColor[1], waveformColor[2]],
		[waveformColor],
	);

	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			query: { startMs: 0, endMs: audioData.durationMs, width, height },
			readSamples: audioData.readSamples,
			config: {
				spectrogram: false,
				loudness: false,
			},
		}),
		[audioData, width, height],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	// The result whose waveform is drawn: the fresh `ready` result, else the last
	// good one held through a recompute or error. Null only before any result.
	const renderable =
		computeResult.status === "ready"
			? computeResult
			: computeResult.status === "computing" || computeResult.status === "error"
				? computeResult.previous
				: null;

	const vpStartPct = viewStartFrac * 100;
	const vpWidthPct = (viewEndFrac - viewStartFrac) * 100;

	return (
		<div
			ref={minimapRef}
			className={`relative h-8 bg-void${onScrubToFraction ? " cursor-ew-resize" : ""}`}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
		>
			{renderable !== null && (
				<div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
					<WaveformCanvas computeResult={renderable} color={color} />
				</div>
			)}
			{/* Shimmer only (no bar) while first-computing — the minimaps carry no
          progress bar per the v1 language. */}
			{computeResult.status === "computing" && computeResult.previous === null && <ComputeProgress />}
			<div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: `${vpStartPct}%` }} />
			<div className="absolute inset-y-0 right-0 bg-black/65" style={{ width: `${(1 - viewEndFrac) * 100}%` }} />
			{/* Viewport bracket — the scroll-window indicator. No grab-handle chips;
          the bracket box itself is the affordance. */}
			<div
				className="absolute inset-y-0 cursor-ew-resize border-2 border-data-selection-border"
				style={{ left: `${vpStartPct}%`, width: `${vpWidthPct}%` }}
			/>
		</div>
	);
}
