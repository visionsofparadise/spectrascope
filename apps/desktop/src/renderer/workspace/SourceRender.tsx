import { useCallback, useEffect, useMemo, useRef, memo } from "react";
import { SpectrogramCanvas, WaveformCanvas, useDisplayCompute } from "spectral-display";
import { hexToRgb255 } from "./spectral/colorUtil";
import { ComputeProgress } from "./spectral/ComputeProgress";
import { displayResultKey } from "./spectral/displayResultKey";
import { tileCoverageMask } from "./spectral/tileCoverageMask";
import { useComputeSize } from "./spectral/useComputeSize";
import { useContainerSize } from "./spectral/useContainerSize";
import { computeWindowTransform } from "./useTimeViewport";
import { formatInspectionTime } from "./utils/formatInspectionTime";
import { fractionToFrequency } from "./utils/frequencyScale";
import { SPECTROGRAM_COLORMAPS } from "./utils/spectrogramColormaps";
import { spectrogramPlacement } from "./utils/spectrogramPlacement";
import type { Source } from "./source";
import type { AudioData } from "./spectral/types";
import type { DisplayedWaveform } from "./spectral/useWaveformReadouts";
import type { FrequencyScale, SpectrogramSampling } from "spectral-display";
import type { TextureVerticalRange } from "spectral-display";
import type { ChannelInput, ComputeResultReady, SpectralOptions } from "spectral-display";

export interface SourceRenderCursorReadout {
	readonly sourceId: string;
	readonly timeMs: number;
	readonly frequencyHz: number;
	readonly time: string;
	readonly freq: string;
	readonly amp: string;
}

export interface SourceRenderProps {
	readonly source: Source;
	readonly frequencyScale?: FrequencyScale;
	readonly spectrogramSampling: SpectrogramSampling;
	readonly spectrogramColormap?: "lava" | "viridis";
	readonly spectrogram?: boolean;
	readonly displaySampleRate?: number;
	readonly frequencyRange?: TextureVerticalRange;
	readonly onDisplayedResultChange?: (sourceId: string, displayed: DisplayedWaveform | null) => void;
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
	readonly liveStartMs?: number;
	readonly liveEndMs?: number;
	readonly readoutTimeOffsetMs?: number;
	readonly freezeCompute?: boolean;
	readonly fftSize: number;
	readonly hopOverlap: number;
	readonly channelInput: ChannelInput;
	readonly opacity?: number;
	readonly clipPath?: string;
	/**
	 * Per-layer opacity for the two stacked canvas layers — the waveform drawn
	 * on top and the spectrogram underneath. `0..1`, default `1`. This is the
	 * compositing hook the per-view right-column layer-opacity knobs drive; it
	 * is distinct from the render-level `opacity` above (the Overlay view's
	 * per-render blend opacity). The render has no loudness layer, so there is no
	 * loudness-opacity prop.
	 */
	readonly waveformOpacity?: number;
	readonly spectrogramOpacity?: number;
	readonly onCursorMove?: (readout: SourceRenderCursorReadout) => void;
}

export function SourceRender({
	source,
	frequencyScale = "mel",
	spectrogramSampling,
	spectrogramColormap = "lava",
	spectrogram = true,
	frequencyRange,
	onDisplayedResultChange,
	audioData,
	displaySampleRate = audioData.sampleRate,
	startMs,
	endMs,
	liveStartMs,
	liveEndMs,
	readoutTimeOffsetMs = 0,
	freezeCompute = false,
	fftSize,
	hopOverlap,
	channelInput,
	opacity = 1,
	clipPath,
	waveformOpacity = 1,
	spectrogramOpacity = 1,
	onCursorMove,
}: SourceRenderProps) {
	const displayRef = useRef<HTMLDivElement>(null);
	const analysisAudio = audioData.timelinePlacement?.source ?? audioData;
	const placementMs = ((audioData.timelinePlacement?.offsetSamples ?? 0) * 1000) / audioData.sampleRate;
	const { width, height } = useComputeSize(useContainerSize(displayRef, { width: 800, height: 400 }));

	const waveformColor = useMemo<[number, number, number]>(
		() => hexToRgb255(source.layerColor.primary, [255, 255, 255]),
		[source.layerColor.primary],
	);

	const handleMouseMove = useCallback(
		(ev: React.MouseEvent<HTMLDivElement>) => {
			if (!onCursorMove || !displayRef.current) return;

			const rect = displayRef.current.getBoundingClientRect();

			if (rect.width <= 0 || rect.height <= 0) return;

			const xFrac = (ev.clientX - rect.left) / rect.width;
			const yFrac = (ev.clientY - rect.top) / rect.height;

			const cursorStartMs = liveStartMs ?? startMs;
			const cursorEndMs = liveEndMs ?? endMs;
			const timeMs = readoutTimeOffsetMs + cursorStartMs + xFrac * (cursorEndMs - cursorStartMs);
			const timeStr = formatInspectionTime(timeMs);

			const displayFrequency = fractionToFrequency(yFrac, displaySampleRate, frequencyRange, frequencyScale);
			const nyquist = audioData.sampleRate / 2;
			const hasFrequency = spectrogram && displayFrequency <= nyquist * (1 + Number.EPSILON * 8);
			const freqHz = hasFrequency ? Math.min(displayFrequency, nyquist) : 0;
			const freqStr = hasFrequency
				? freqHz >= 1000
					? `${(freqHz / 1000).toFixed(1)} kHz`
					: `${Math.round(freqHz)} Hz`
				: "—";

			onCursorMove({ sourceId: source.id, timeMs, frequencyHz: freqHz, time: timeStr, freq: freqStr, amp: "—" });
		},
		[
			onCursorMove,
			startMs,
			endMs,
			liveStartMs,
			liveEndMs,
			readoutTimeOffsetMs,
			audioData.sampleRate,
			displaySampleRate,
			frequencyRange,
			frequencyScale,
			source.id,
			spectrogram,
		],
	);

	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: analysisAudio.sampleRate,
				sampleCount: analysisAudio.totalSamples,
				channelCount: analysisAudio.channels,
			},
			query: { startMs: startMs - placementMs, endMs: endMs - placementMs, width, height },
			readSamples: analysisAudio.readSamples,
			config: {
				displayTiles: true,
				fftSize,
				hopOverlap,
				frequencyScale,
				spectrogramSampling,
				colormap: SPECTROGRAM_COLORMAPS[spectrogramColormap],
				spectrogram,
				channelInput,
				loudness: false,
				truePeak: false,
			},
		}),
		[
			analysisAudio.sampleRate,
			analysisAudio.totalSamples,
			analysisAudio.channels,
			analysisAudio.readSamples,
			placementMs,
			startMs,
			endMs,
			width,
			height,
			fftSize,
			hopOverlap,
			channelInput,
			spectrogramColormap,
			spectrogram,
			frequencyScale,
			spectrogramSampling,
		],
	);

	const computeOptionsRef = useRef(spectralOptions);

	if (
		!freezeCompute ||
		spectralOptions.query.startMs !== computeOptionsRef.current.query.startMs ||
		spectralOptions.query.endMs !== computeOptionsRef.current.query.endMs
	)
		computeOptionsRef.current = spectralOptions;

	const computeResult = useDisplayCompute(computeOptionsRef.current);

	const waveformResults = useMemo(
		() => computeResult.tiles.flatMap((tile) => (tile.waveform ? [tile.waveform] : [])),
		[computeResult.tiles],
	);
	const spectrogramResults = useMemo(
		() =>
			computeResult.tiles.flatMap((tile) =>
				spectrogram && tile.spectrogram?.options.config.frequencyScale === frequencyScale ? [tile.spectrogram] : [],
			),
		[computeResult.tiles, frequencyScale, spectrogram],
	);
	const hasCoverage = waveformResults.length > 0 || spectrogramResults.length > 0;

	useEffect(() => {
		onDisplayedResultChange?.(
			source.id,
			hasCoverage
				? {
						results: waveformResults,
						sourceName: source.name,
						timeOffsetMs: readoutTimeOffsetMs + placementMs,
					}
				: null,
		);
	}, [
		source.id,
		source.name,
		waveformResults,
		hasCoverage,
		readoutTimeOffsetMs,
		placementMs,
		onDisplayedResultChange,
	]);
	useEffect(() => () => onDisplayedResultChange?.(source.id, null), [source.id, onDisplayedResultChange]);

	const live = { startMs: liveStartMs ?? startMs, endMs: liveEndMs ?? endMs };
	const transformFor = (result: ComputeResultReady) => ({
		transform: computeWindowTransform(
			{ startMs: result.query.startMs + placementMs, endMs: result.query.endMs + placementMs },
			live,
		),
		transformOrigin: "left",
	});
	const updating = hasCoverage && computeResult.status === "computing";
	const progressFraction = computeResult.fraction;
	const progressPercent = Number.isFinite(progressFraction)
		? Math.round(Math.max(0, Math.min(1, progressFraction)) * 100)
		: 0;

	return (
		<div
			ref={displayRef}
			className={`absolute inset-0 overflow-hidden${spectrogram ? " bg-void" : ""}`}
			style={{ opacity, clipPath }}
			onMouseMove={handleMouseMove}
		>
			{spectrogram &&
				spectrogramResults.map((result, index) => (
					<div
						key={displayResultKey(result)}
						data-display-layer="spectrogram"
						data-tile-start-ms={result.query.startMs}
						className="absolute inset-0"
						style={{
							...transformFor(result),
							maskImage: tileCoverageMask(result, spectrogramResults.slice(index + 1)),
						}}
					>
						<SpectrumTile
							result={result}
							displaySampleRate={displaySampleRate}
							frequencyRange={frequencyRange}
							frequencyScale={frequencyScale}
							opacity={spectrogramOpacity}
						/>
					</div>
				))}
			{computeResult.tiles.map(
				({ waveform: result }, index) =>
					result && (
						<div
							key={displayResultKey(result)}
							data-display-layer="waveform"
							data-tile-start-ms={result.query.startMs}
							className="absolute inset-0"
							style={{
								...transformFor(result),
								maskImage: tileCoverageMask(
									result,
									computeResult.tiles
										.slice(index + 1)
										.flatMap((tile) => (tile.waveform ? [tile.waveform] : [])),
								),
							}}
						>
							<WaveformTile
								result={result}
								color={waveformColor}
								frequencyRange={frequencyRange}
								opacity={waveformOpacity}
							/>
						</div>
					),
			)}
			{!hasCoverage && computeResult.status === "computing" && <ComputeProgress fraction={computeResult.fraction} />}
			{updating && (
				<div
					role="progressbar"
					aria-label={`Updating analysis for ${source.name}`}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={progressPercent}
					aria-valuetext={progressPercent === 100 ? "Rendering updated view" : `${progressPercent}%`}
					className="pointer-events-none absolute inset-x-0 top-0 z-20"
				>
					<div className="h-0.5 bg-chrome-border">
						<div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
					</div>
					<span className="absolute right-2 top-1 rounded-sm bg-void/80 px-1 py-0.5 font-technical text-[length:var(--text-xs)] text-chrome-text-secondary">
						Updating view…
					</span>
				</div>
			)}
			{computeResult.status === "error" && (
				<div
					role="status"
					className="pointer-events-none absolute bottom-1 left-2 font-technical text-[length:var(--text-xs)] text-chrome-text-secondary"
				>
					{hasCoverage ? "Analysis update failed: " : "Analysis unavailable: "}
					{computeResult.error?.message}
				</div>
			)}
		</div>
	);
}

const WaveformTile = memo(
	({
		result,
		color,
		frequencyRange,
		opacity,
	}: {
		readonly result: ComputeResultReady;
		readonly color: [number, number, number];
		readonly frequencyRange?: TextureVerticalRange;
		readonly opacity: number;
	}) => (
		<div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full" style={{ opacity }}>
			<WaveformCanvas verticalRange={frequencyRange} computeResult={result} color={color} />
		</div>
	),
);

const SpectrumTile = memo(
	({
		result,
		displaySampleRate,
		frequencyRange,
		frequencyScale,
		opacity,
	}: {
		readonly result: ComputeResultReady;
		readonly displaySampleRate: number;
		readonly frequencyRange?: TextureVerticalRange;
		readonly frequencyScale: FrequencyScale;
		readonly opacity: number;
	}) => {
		const placement = useMemo(
			() =>
				spectrogramPlacement(result.options.metadata.sampleRate, displaySampleRate, frequencyRange, frequencyScale),
			[result.options.metadata.sampleRate, displaySampleRate, frequencyRange, frequencyScale],
		);

		return (
			<div
				className="absolute inset-x-0 [&>canvas]:h-full [&>canvas]:w-full"
				style={{
					opacity,
					top: `${placement.top * 100}%`,
					height: `${placement.height * 100}%`,
					visibility: placement.visible ? undefined : "hidden",
				}}
			>
				<SpectrogramCanvas frequencyRange={placement.range} computeResult={result} />
			</div>
		);
	},
);
