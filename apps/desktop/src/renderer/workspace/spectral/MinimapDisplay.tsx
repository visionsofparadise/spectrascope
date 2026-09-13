import { useCallback, useMemo, useRef, memo } from "react";
import { WaveformCanvas, useDisplayCompute } from "spectral-display";
import { computeWindowTransform } from "../useTimeViewport";
import { hexToRgb255 } from "./colorUtil";
import { ComputeProgress } from "./ComputeProgress";
import { displayResultKey } from "./displayResultKey";
import { tileCoverageMask } from "./tileCoverageMask";
import { useComputeSize } from "./useComputeSize";
import { useContainerSize } from "./useContainerSize";
import type { AudioData } from "./types";
import type { SourceWithAudio } from "../views/viewAudio";
import type { ChannelInput, ComputeResultReady, SpectralOptions } from "spectral-display";

interface MinimapLayer {
	readonly id: string;
	readonly audioData: AudioData;
	readonly color: readonly [number, number, number];
}

export function minimapLayersOf(sources: ReadonlyArray<SourceWithAudio>): ReadonlyArray<MinimapLayer> {
	return sources.map(({ source, audioData }) => ({
		id: source.id,
		audioData,
		color: hexToRgb255(source.layerColor.primary),
	}));
}

interface MinimapDisplayProps {
	readonly layers: ReadonlyArray<MinimapLayer>;
	readonly viewStartFrac: number;
	readonly viewEndFrac: number;
	readonly channelInput?: ChannelInput;
	/**
	 * Click / drag on the strip reports the pointer's `[0, 1]` fraction of the
	 * full duration. The view recentres its viewport window on that fraction.
	 * Omitted by the trace views that render a whole-clip minimap.
	 */
	readonly onScrubToFraction?: (fraction: number) => void;
}

export function MinimapDisplay({
	layers,
	viewStartFrac,
	viewEndFrac,
	channelInput = "mono",
	onScrubToFraction,
}: MinimapDisplayProps) {
	const minimapRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{ pointerId: number; left: number; width: number; grabOffset: number; span: number } | null>(
		null,
	);
	const { width, height } = useComputeSize(useContainerSize(minimapRef, { width: 800, height: 48 }));
	const scrubRef = useRef(onScrubToFraction);

	scrubRef.current = onScrubToFraction;

	const scrubAt = useCallback((clientX: number) => {
		const drag = dragRef.current;

		if (!drag) return;

		const center = (clientX - drag.left) / drag.width - drag.grabOffset;

		scrubRef.current?.(Math.max(drag.span / 2, Math.min(1 - drag.span / 2, center)));
	}, []);

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!onScrubToFraction || event.button !== 0 || dragRef.current) return;

			const rect = event.currentTarget.getBoundingClientRect();

			if (rect.width <= 0) return;

			event.preventDefault();
			event.currentTarget.focus({ preventScroll: true });
			event.currentTarget.setPointerCapture(event.pointerId);

			const fraction = (event.clientX - rect.left) / rect.width;
			const inside = fraction >= viewStartFrac && fraction <= viewEndFrac;

			dragRef.current = {
				pointerId: event.pointerId,
				left: rect.left,
				width: rect.width,
				span: viewEndFrac - viewStartFrac,
				grabOffset: inside ? fraction - (viewStartFrac + viewEndFrac) / 2 : 0,
			};
			scrubAt(event.clientX);
		},
		[onScrubToFraction, viewStartFrac, viewEndFrac, scrubAt],
	);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (dragRef.current?.pointerId !== event.pointerId) return;

			event.preventDefault();
			scrubAt(event.clientX);
		},
		[scrubAt],
	);
	const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		if (dragRef.current?.pointerId !== event.pointerId) return;

		dragRef.current = null;

		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
	}, []);

	const vpStartPct = viewStartFrac * 100;
	const vpWidthPct = (viewEndFrac - viewStartFrac) * 100;

	return (
		<div
			ref={minimapRef}
			className={`relative h-8 touch-none select-none overflow-hidden bg-void outline-none focus-visible:ring-1 focus-visible:ring-primary${onScrubToFraction ? " cursor-ew-resize" : ""}`}
			role="slider"
			tabIndex={onScrubToFraction ? 0 : -1}
			aria-label="Time viewport"
			aria-valuemin={0}
			aria-valuemax={1}
			aria-valuenow={(viewStartFrac + viewEndFrac) / 2}
			aria-disabled={!onScrubToFraction}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={(event) => {
				if (dragRef.current?.pointerId === event.pointerId) scrubAt(event.clientX);

				endDrag(event);
			}}
			onPointerCancel={endDrag}
			onLostPointerCapture={(event) => {
				if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
			}}
			onKeyDown={(event) => {
				if (!onScrubToFraction) return;

				const span = viewEndFrac - viewStartFrac;
				const center = (viewStartFrac + viewEndFrac) / 2;
				const next =
					event.key === "ArrowLeft"
						? center - span / 10
						: event.key === "ArrowRight"
							? center + span / 10
							: event.key === "Home"
								? span / 2
								: event.key === "End"
									? 1 - span / 2
									: null;

				if (next !== null) {
					event.preventDefault();
					onScrubToFraction(Math.max(span / 2, Math.min(1 - span / 2, next)));
				}
			}}
		>
			{layers.map((layer) => (
				<MinimapLayerTiles
					key={layer.id}
					audioData={layer.audioData}
					color={layer.color}
					channelInput={channelInput}
					width={width}
					height={height}
					blend={layers.length > 1}
				/>
			))}
			<div
				className="pointer-events-none absolute inset-y-0 left-0 bg-black/60"
				style={{ width: `${vpStartPct}%` }}
			/>
			<div
				className="pointer-events-none absolute inset-y-0 right-0 bg-black/60"
				style={{ width: `${(1 - viewEndFrac) * 100}%` }}
			/>
			<div
				className="pointer-events-none absolute inset-y-0 bg-[rgba(224,224,232,0.17)]"
				style={{ left: `${vpStartPct}%`, width: `${vpWidthPct}%` }}
			/>
		</div>
	);
}

const MinimapWaveform = memo(
	({ result, color }: { readonly result: ComputeResultReady; readonly color: [number, number, number] }) => (
		<WaveformCanvas computeResult={result} color={color} />
	),
);

interface MinimapLayerTilesProps {
	readonly audioData: AudioData;
	readonly color: readonly [number, number, number];
	readonly channelInput: ChannelInput;
	readonly width: number;
	readonly height: number;
	readonly blend: boolean;
}

function MinimapLayerTiles({ audioData, color, channelInput, width, height, blend }: MinimapLayerTilesProps) {
	const [red, green, blue] = color;
	const waveformColor = useMemo<[number, number, number]>(() => [red, green, blue], [red, green, blue]);

	const spectralOptions = useMemo<SpectralOptions>(() => {
		const analysisAudio = audioData.timelinePlacement?.source ?? audioData;
		const offsetMs = ((audioData.timelinePlacement?.offsetSamples ?? 0) * 1000) / audioData.sampleRate;

		return {
			metadata: {
				sampleRate: analysisAudio.sampleRate,
				sampleCount: analysisAudio.totalSamples,
				channelCount: analysisAudio.channels,
			},
			query: { startMs: -offsetMs, endMs: audioData.durationMs - offsetMs, width, height },
			readSamples: analysisAudio.readSamples,
			config: {
				displayTiles: true,
				spectrogram: false,
				loudness: false,
				truePeak: false,
				channelInput,
			},
		};
	}, [audioData, width, height, channelInput]);

	const computeResult = useDisplayCompute(spectralOptions);

	const hasCoverage = computeResult.tiles.some((tile) => tile.waveform);

	return (
		<div className="pointer-events-none absolute inset-0" style={blend ? { mixBlendMode: "lighten" } : undefined}>
			{computeResult.tiles.map(
				({ waveform: renderable }, index) =>
					renderable && (
						<div
							key={displayResultKey(renderable)}
							data-display-layer="waveform"
							data-tile-start-ms={renderable.query.startMs}
							className="pointer-events-none absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full"
							style={{
								maskImage: tileCoverageMask(
									renderable,
									computeResult.tiles
										.slice(index + 1)
										.flatMap((tile) => (tile.waveform ? [tile.waveform] : [])),
								),
								transform: computeWindowTransform(
									{
										startMs:
											renderable.query.startMs +
											((audioData.timelinePlacement?.offsetSamples ?? 0) * 1000) / audioData.sampleRate,
										endMs:
											renderable.query.endMs +
											((audioData.timelinePlacement?.offsetSamples ?? 0) * 1000) / audioData.sampleRate,
									},
									{ startMs: 0, endMs: audioData.durationMs },
								),
								transformOrigin: "left",
							}}
						>
							<MinimapWaveform result={renderable} color={waveformColor} />
						</div>
					),
			)}
			{computeResult.status === "computing" && !hasCoverage && <ComputeProgress fraction={computeResult.fraction} />}
		</div>
	);
}
