import { useMemo } from "react";
import { getBandFrequencies } from "spectral-display";
import { LinearDbAxis } from "../spectral/Axes";
import { ChartSvg, HorizontalGridlines, TracePolylines, VerticalGridlines } from "../spectral/chartMarks";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { FREQUENCY_TICK_LABELS } from "../spectral/timeTicks";
import { useTraceCompute } from "../spectral/traceCompute";
import { useDisabledTransport } from "../spectral/viewScaffold";
import { buildPolylineSegments } from "./chartTrace";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { SourceWithAudio } from "./viewAudio";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
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

const DB_TICKS: ReadonlyArray<number> = [0, -10, -20, -30, -40, -50, -60, -70, -80, -90];

export function magnitudeToDb(magnitude: number): number {
	return 20 * Math.log10(Math.max(magnitude, 1e-10));
}

export function freqToX(freqHz: number): number {
	const logMin = Math.log10(FREQ_MIN_HZ);
	const logMax = Math.log10(FREQ_MAX_HZ);

	return (Math.log10(freqHz) - logMin) / (logMax - logMin);
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

	const { computeResult, renderable } = useTraceCompute(audioData, 0, audioData.durationMs, ltasConfig);

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
}

const FREQ_GRID_FRACTIONS: ReadonlyArray<number> = FREQ_TICKS.map((tick) => freqToX(tick.hz));
const DB_GRID_FRACTIONS: ReadonlyArray<number> = DB_TICKS.map((db) => dbToY(db));

function ChartCanvas({ renderableSources, fftSize, hopOverlap, channelInput, onComputeState }: ChartCanvasProps) {
	return (
		<div className="relative h-full w-full overflow-hidden bg-void">
			<VerticalGridlines fractions={FREQ_GRID_FRACTIONS} />
			<HorizontalGridlines fractions={DB_GRID_FRACTIONS} />
			<ChartSvg>
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

function HorizontalFrequencyAxis() {
	return (
		<div
			className="relative h-6 bg-void font-technical text-chrome-text-secondary"
			style={{
				fontSize: "var(--text-xs)",
				letterSpacing: "0.02em",
				fontVariantNumeric: "tabular-nums",
			}}
		>
			<div className="absolute top-0 left-0 right-0 h-px bg-chrome-border-subtle" />
			{FREQ_TICKS.map((tick) => {
				const xPct = freqToX(tick.hz) * 100;

				return (
					<div
						key={tick.hz}
						className="absolute top-0"
						style={{ left: `${xPct}%`, transform: "translateX(-50%)" }}
					>
						<span className="absolute top-0 left-1/2 h-1.5 w-px -translate-x-1/2 bg-chrome-border" />
						<span className="absolute top-2 left-1/2 -translate-x-1/2 whitespace-nowrap">{tick.label}</span>
					</div>
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

	useDisabledTransport(onTransportControlChange);

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-void">
			<div className="flex min-h-0 flex-1 flex-col py-4 pr-4">
				<div className="flex min-h-0 flex-1">
					<LinearDbAxis ticks={DB_TICKS} />
					<div className="relative min-w-0 flex-1">
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
								/>
								{progress.firstComputing && <ComputeProgress fraction={progress.fraction} />}
							</>
						)}
					</div>
				</div>
				<div className="flex shrink-0">
					<div className="w-10 shrink-0 bg-void" />
					<div className="min-w-0 flex-1">
						<HorizontalFrequencyAxis />
					</div>
				</div>
			</div>
		</div>
	);
}
