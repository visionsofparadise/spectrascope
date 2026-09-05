import { useCallback, useMemo, useRef } from "react";
import { WaveformCanvas, useSpectralCompute } from "spectral-display";
import { ComputeProgress } from "./ComputeProgress";
import { heldComputeResult } from "./computeResult";
import { useContainerSize } from "./useContainerSize";
import type { AudioData } from "./types";
import type { SpectralOptions } from "spectral-display";

interface MinimapDisplayProps {
	readonly audioData: AudioData;
	readonly viewStartFrac: number;
	readonly viewEndFrac: number;
	readonly waveformColor: readonly [number, number, number];
	/**
	 * Click / drag on the strip reports the pointer's `[0, 1]` fraction of the
	 * full duration. The view recentres its viewport window on that fraction.
	 * Omitted by the trace views that render a whole-clip minimap.
	 */
	readonly onScrubToFraction?: (fraction: number) => void;
}

export function MinimapDisplay({
	audioData,
	viewStartFrac,
	viewEndFrac,
	waveformColor,
	onScrubToFraction,
}: MinimapDisplayProps) {
	const minimapRef = useRef<HTMLDivElement>(null);
	const { width, height } = useContainerSize(minimapRef, { width: 800, height: 48 });

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

	const renderable = heldComputeResult(computeResult);

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
			{computeResult.status === "computing" && computeResult.previous === null && <ComputeProgress />}
			<div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: `${vpStartPct}%` }} />
			<div className="absolute inset-y-0 right-0 bg-black/65" style={{ width: `${(1 - viewEndFrac) * 100}%` }} />
			<div
				className="absolute inset-y-0 cursor-ew-resize border-2 border-data-selection-border"
				style={{ left: `${vpStartPct}%`, width: `${vpWidthPct}%` }}
			/>
		</div>
	);
}
