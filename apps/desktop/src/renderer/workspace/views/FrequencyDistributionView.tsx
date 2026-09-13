import { useMemo } from "react";
import { getBandFrequencies } from "spectral-display";
import { AxisSpacer, LinearDbAxis, linearAxisSampleOf, useLabelFit } from "../spectral/Axes";
import { ChartSvg, HorizontalGridlines, TracePolylines, VerticalGridlines } from "../spectral/chartMarks";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { EMPTY_READOUT } from "../spectral/readoutRows";
import { ScrollTrack } from "../spectral/ScrollTrack";
import { scrollTrackTextsOf, trackValueTextOf } from "../spectral/scrollTrackTexts";
import { FREQUENCY_TICK_LABELS } from "../spectral/timeTicks";
import { useTraceCompute } from "../spectral/traceCompute";
import { visibleValueTicksOf } from "../spectral/valueTicks";
import { ViewProgressProvider, ViewProgressToast } from "../spectral/viewProgress";
import { usePointerReadoutTransport } from "../spectral/viewScaffold";
import { axisFractionOf } from "../utils/axisRange";
import { buildPolylineSegments } from "./chartTrace";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { SourceWithAudio } from "./viewAudio";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl, TransportReadoutRow } from "../Transport";
import type { AxisRange } from "../utils/axisRange";
import type { ViewControlSettings } from "../viewSettings";
import type { ChannelInput, SpectralOptions } from "spectral-display";

interface FrequencyDistributionViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly settings: ViewControlSettings;
	readonly channelInput: ChannelInput;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const FREQ_MIN_HZ = 20;
const FREQ_MAX_HZ = 20000;
const DB_MIN = -90;
const DB_MAX = 0;

const FREQ_TICKS = FREQUENCY_TICK_LABELS;

const DB_TICK_COUNT = 10;
const DB_WIDEST_LABEL = "-90";
const FREQUENCY_MIN_SPAN = 1 / 6;
const LEVEL_MIN_SPAN = 1 / 32;

export function frequencyReadoutRowsOf(
	pointer: { readonly x: number; readonly y: number } | null,
): ReadonlyArray<TransportReadoutRow> {
	const freqHz = pointer ? xToFreq(pointer.x) : 0;

	return [
		{
			label: "Freq",
			cursor: pointer
				? freqHz >= 1000
					? `${(freqHz / 1000).toFixed(1)} kHz`
					: `${Math.round(freqHz)} Hz`
				: EMPTY_READOUT,
			in: EMPTY_READOUT,
			out: EMPTY_READOUT,
		},
		{
			label: "Amp",
			cursor: pointer ? `${(DB_MAX - pointer.y * (DB_MAX - DB_MIN)).toFixed(1)} dB` : EMPTY_READOUT,
			in: EMPTY_READOUT,
			out: EMPTY_READOUT,
		},
	];
}

export function magnitudeToDb(magnitude: number): number {
	return 20 * Math.log10(Math.max(magnitude, 1e-10));
}

export function freqToX(freqHz: number): number {
	const logMin = Math.log10(FREQ_MIN_HZ);
	const logMax = Math.log10(FREQ_MAX_HZ);

	return (Math.log10(freqHz) - logMin) / (logMax - logMin);
}

export function xToFreq(fraction: number): number {
	const logMin = Math.log10(FREQ_MIN_HZ);
	const logMax = Math.log10(FREQ_MAX_HZ);

	return Math.pow(10, logMin + fraction * (logMax - logMin));
}

function dbToY(db: number): number {
	const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));

	return (DB_MAX - clamped) / (DB_MAX - DB_MIN);
}

interface SourceLtasTraceProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly fftSize: number;
	readonly hopOverlap: number;
	readonly channelInput: ChannelInput;
	readonly onComputeState?: (sourceId: string, state: ComputeState | null) => void;
}

function SourceLtasTrace({
	source,
	audioData,
	fftSize,
	hopOverlap,
	channelInput,
	onComputeState,
}: SourceLtasTraceProps) {
	const ltasConfig = useMemo<SpectralOptions["config"]>(
		() => ({
			ltas: true,
			spectrogram: false,
			loudness: false,
			truePeak: false,
			fftSize,
			hopOverlap,
			frequencyScale: "log",
			channelInput,
		}),
		[fftSize, hopOverlap, channelInput],
	);

	const { computeResult, renderable } = useTraceCompute(audioData, 0, audioData.durationMs, ltasConfig, source.id);

	const ltas = renderable ? renderable.ltas : null;
	const sampleRate = audioData.sampleRate;

	const segments = useMemo(() => {
		if (!ltas || ltas.length === 0) return [];

		const bandFrequencies = getBandFrequencies("log", ltas.length, sampleRate, fftSize);

		return buildPolylineSegments(
			ltas,
			(magnitude) => dbToY(magnitudeToDb(magnitude)),
			(index) => freqToX(bandFrequencies[index] ?? FREQ_MIN_HZ),
		);
	}, [ltas, sampleRate, fftSize]);

	useReportComputeState(source.id, computeResult, onComputeState);

	if (segments.length === 0) return null;

	const color = source.layerColor.primary;

	return (
		<g>
			<TracePolylines segments={segments} color={color} />
		</g>
	);
}

interface ChartCanvasProps {
	readonly renderableSources: ReadonlyArray<SourceWithAudio>;
	readonly fftSize: number;
	readonly hopOverlap: number;
	readonly channelInput: ChannelInput;
	readonly onComputeState: (sourceId: string, state: ComputeState | null) => void;
	readonly xRange: AxisRange;
	readonly yRange: AxisRange;
}

const FREQ_GRID_FRACTIONS: ReadonlyArray<number> = FREQ_TICKS.map((tick) => freqToX(tick.hz));

function ChartCanvas({
	renderableSources,
	fftSize,
	hopOverlap,
	channelInput,
	onComputeState,
	xRange,
	yRange,
}: ChartCanvasProps) {
	return (
		<div className="relative h-full w-full overflow-hidden bg-void">
			<VerticalGridlines fractions={FREQ_GRID_FRACTIONS} range={xRange} />
			<HorizontalGridlines
				fractions={visibleValueTicksOf(DB_MIN, DB_MAX, yRange, DB_TICK_COUNT).map(dbToY)}
				range={yRange}
			/>
			<ChartSvg xRange={xRange} yRange={yRange}>
				{renderableSources.map(({ source, audioData }) => (
					<SourceLtasTrace
						key={source.id}
						source={source}
						audioData={audioData}
						fftSize={fftSize}
						hopOverlap={hopOverlap}
						channelInput={channelInput}
						onComputeState={onComputeState}
					/>
				))}
			</ChartSvg>
		</div>
	);
}

function HorizontalFrequencyAxis({ range }: { readonly range: AxisRange }) {
	const labelFit = useLabelFit(22);

	return (
		<div
			ref={labelFit.ref}
			className="relative h-6 bg-void font-technical text-chrome-text-secondary"
			style={{
				fontSize: "var(--text-xs)",
				letterSpacing: "0.02em",
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{FREQ_TICKS.map((tick) => {
				const position = axisFractionOf(freqToX(tick.hz), range);

				if (position < 0 || position > 1 || !labelFit.fits(position)) return null;

				return (
					<span
						key={tick.hz}
						className="absolute bottom-0.5 whitespace-nowrap"
						style={{ left: `${position * 100}%`, transform: "translateX(-50%)" }}
					>
						{tick.label}
					</span>
				);
			})}
		</div>
	);
}

export function FrequencyDistributionView({
	sources,
	sourceAudio,
	settings,
	channelInput,
	onTransportControlChange,
}: FrequencyDistributionViewProps) {
	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	const progress = useFirstComputeProgress();

	const { xRange, setXRange, yRange, setYRange, onMouseMove, onMouseLeave } = usePointerReadoutTransport(
		renderableSources,
		frequencyReadoutRowsOf,
		onTransportControlChange,
	);

	const axisSample = linearAxisSampleOf(DB_MIN, DB_MAX, DB_TICK_COUNT, yRange, DB_WIDEST_LABEL);

	return (
		<ViewProgressProvider>
			<div className="flex h-full min-h-0 w-full flex-col bg-void">
				<div className="flex min-h-0 flex-1 flex-col">
					<div className="flex shrink-0">
						<AxisSpacer sample={axisSample} />
						<div className="min-w-0 flex-1">
							<HorizontalFrequencyAxis range={xRange} />
						</div>
						<div className="w-2 shrink-0" />
					</div>
					<div className="flex min-h-0 flex-1">
						<LinearDbAxis
							min={DB_MIN}
							max={DB_MAX}
							tickCount={DB_TICK_COUNT}
							range={yRange}
							sample={DB_WIDEST_LABEL}
						/>
						<div className="relative min-w-0 flex-1" onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
							{renderableSources.length === 0 ? (
								<div className="flex h-full items-center justify-center bg-void">
									<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
								</div>
							) : (
								<>
									<ChartCanvas
										renderableSources={renderableSources}
										fftSize={settings.fftSize}
										hopOverlap={settings.hopOverlap}
										channelInput={channelInput}
										onComputeState={progress.handleComputeState}
										xRange={xRange}
										yRange={yRange}
									/>
									{progress.firstComputing && <ComputeProgress fraction={progress.fraction} />}
								</>
							)}
							<ViewProgressToast />
						</div>
						<ScrollTrack
							axis="y"
							className="shrink-0"
							range={yRange}
							minSpan={LEVEL_MIN_SPAN}
							onRangeChange={setYRange}
							{...scrollTrackTextsOf(
								"y",
								"Level range",
								yRange,
								(fraction) => trackValueTextOf(DB_MAX - fraction * (DB_MAX - DB_MIN)),
								"dB",
							)}
						/>
					</div>
					<div className="flex shrink-0">
						<AxisSpacer sample={axisSample} />
						<ScrollTrack
							axis="x"
							className="min-w-0 flex-1"
							range={xRange}
							minSpan={FREQUENCY_MIN_SPAN}
							onRangeChange={setXRange}
							{...scrollTrackTextsOf(
								"x",
								"Frequency range",
								xRange,
								(fraction) => String(Math.round(xToFreq(fraction))),
								"Hz",
							)}
						/>
						<div className="w-2 shrink-0" />
					</div>
				</div>
			</div>
		</ViewProgressProvider>
	);
}
