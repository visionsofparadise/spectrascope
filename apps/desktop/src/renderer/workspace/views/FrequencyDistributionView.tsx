import { useEffect, useMemo } from "react";
import { getBandFrequencies, useSpectralCompute } from "spectral-display";
import { LinearDbAxis } from "../spectral/Axes";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { buildPolylineSegments } from "./chartTrace";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { SourceWithAudio } from "./viewAudio";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { ViewControlSettings } from "../viewSettings";
import type { ChannelInput, SpectralOptions } from "spectral-display";

/**
 * FrequencyDistributionView — per-source long-term-average-spectrum (LTAS) lines
 * on a single chart. Frequency on X (log, 20 Hz → 20 kHz), magnitude on Y (dB,
 * -90 → 0). One polyline per visible source, drawn in `source.layerColor.primary`
 * at full opacity.
 *
 * Each renderable source runs `useSpectralCompute` with `ltas: true` (the whole
 * clip — this view has no time axis) via the `<SourceLtasTrace>` sub-component
 * (a hook must be called from a render function — one per source). The package
 * returns linear mean magnitudes per band; this view converts them to dB and
 * places each band on the log-frequency axis by its center frequency
 * (`getBandFrequencies`).
 *
 * **View-level chrome scope**:
 * - Kept: a single chart pane filling the workspace area, the dB axis on the
 *   left and a horizontal log-frequency axis underneath.
 * - Dropped: TimeRuler (no time dimension), the right-column display controls
 *   block, FrequencyMinimap (no time scope to navigate), and the cursor readout
 *   chip.
 *
 * **Axis composition**: the linear dB axis is the shared `LinearDbAxis`
 * (`components/spectral/Axes.tsx`), fed this view's `DB_TICKS` (0 → -90). The
 * horizontal log-frequency axis is unique to this view and stays inlined as
 * `HorizontalFrequencyAxis`.
 */

interface FrequencyDistributionViewProps {
	readonly sources: ReadonlyArray<Source>;
	/** Per-source PCM readers, keyed by `Source.id`. */
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	/** Shared display-control settings — supplies the FFT size and hop overlap. */
	readonly settings: ViewControlSettings;
	/** The global Mono/Mid/Side channel-input mode, folded into each source's compute. */
	readonly channelInput: ChannelInput;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const FREQ_MIN_HZ = 20;
const FREQ_MAX_HZ = 20000;
const DB_MIN = -90;
const DB_MAX = 0;

const FREQ_TICKS: ReadonlyArray<{ hz: number; label: string }> = [
	{ hz: 20, label: "20" },
	{ hz: 50, label: "50" },
	{ hz: 100, label: "100" },
	{ hz: 200, label: "200" },
	{ hz: 500, label: "500" },
	{ hz: 1000, label: "1k" },
	{ hz: 2000, label: "2k" },
	{ hz: 5000, label: "5k" },
	{ hz: 10000, label: "10k" },
	{ hz: 20000, label: "20k" },
];

const DB_TICKS: ReadonlyArray<number> = [0, -10, -20, -30, -40, -50, -60, -70, -80, -90];

/**
 * Disabled `TransportControl` published by this view. Frequency Distribution
 * has no playback — the LTAS is a static whole-clip aggregate.
 */
const DISABLED_CONTROL: TransportControl = {
	disabled: true,
	playing: false,
	positionSec: 0,
	durationSec: 0,
	onPlayToggle: () => {},
	onSeek: () => {},
};

/**
 * Convert a linear mean magnitude to dB. `getBandFrequencies`-aligned LTAS
 * magnitudes are non-negative linear values; the `1e-10` floor keeps a
 * zero-energy band at a finite -200 dB instead of -Infinity.
 */
export function magnitudeToDb(magnitude: number): number {
	return 20 * Math.log10(Math.max(magnitude, 1e-10));
}

/** Map a frequency (Hz) to a [0, 1] X fraction along the log axis. */
export function freqToX(freqHz: number): number {
	const logMin = Math.log10(FREQ_MIN_HZ);
	const logMax = Math.log10(FREQ_MAX_HZ);

	return (Math.log10(freqHz) - logMin) / (logMax - logMin);
}

/** Map a magnitude (dB) to a [0, 1] Y fraction, top = 0 dB, bottom = -90 dB. */
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

/**
 * Sub-component that runs `useSpectralCompute` for one source with the LTAS
 * reduction enabled over the whole clip, then renders one polyline per finite
 * run of the resulting spectrum. Bands are placed on the log-frequency axis by
 * their center frequency; magnitudes convert to dB. A source still preparing
 * (or one whose clip is too short for the FFT — the engine throws, leaving
 * `ltas` null) renders nothing.
 */
function SourceLtasTrace({
	source,
	audioData,
	fftSize,
	hopOverlap,
	channelInput,
	onComputeState,
}: SourceLtasTraceProps) {
	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			// The view has no time axis — the query spans the whole clip. Width and
			// height are required but nothing draws a canvas for an LTAS-only run.
			query: { startMs: 0, endMs: audioData.durationMs, width: 64, height: 64 },
			readSamples: audioData.readSamples,
			config: {
				ltas: true,
				spectrogram: false,
				loudness: false,
				truePeak: false,
				fftSize,
				hopOverlap,
				frequencyScale: "log",
				channelInput,
			},
		}),
		[
			audioData.sampleRate,
			audioData.totalSamples,
			audioData.channels,
			audioData.durationMs,
			audioData.readSamples,
			fftSize,
			hopOverlap,
			channelInput,
		],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	// The result whose LTAS is drawn: the fresh `ready` result, else the last
	// good one held through a recompute or error. Null only before any result.
	const renderable =
		computeResult.status === "ready"
			? computeResult
			: computeResult.status === "computing" || computeResult.status === "error"
				? computeResult.previous
				: null;

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
			{segments.map((points, index) => (
				<polyline
					key={index}
					points={points}
					fill="none"
					stroke={color}
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			))}
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

function ChartCanvas({ renderableSources, fftSize, hopOverlap, channelInput, onComputeState }: ChartCanvasProps) {
	return (
		<div className="relative h-full w-full overflow-hidden bg-void">
			{/* Gridlines — log frequency verticals + dB horizontals. Painted as
			    absolutely-positioned divs at the chart-edge gridline positions, so
			    they line up with the axis tick labels rendered outside this box. */}
			{FREQ_TICKS.map((tick) => {
				const xPct = freqToX(tick.hz) * 100;

				return (
					<div
						key={`v${tick.hz}`}
						className="pointer-events-none absolute top-0 bottom-0 w-px bg-chrome-border-subtle"
						style={{ left: `${xPct}%` }}
					/>
				);
			})}
			{DB_TICKS.map((db) => {
				const yPct = dbToY(db) * 100;

				return (
					<div
						key={`h${db}`}
						className="pointer-events-none absolute left-0 right-0 h-px bg-chrome-border-subtle"
						style={{ top: `${yPct}%` }}
					/>
				);
			})}
			{/* Polylines in fractional 0..1 viewBox space so they scale to whatever
			    pixel size the container resolves to without needing a measurement
			    pass. `preserveAspectRatio="none"` lets the chart stretch to fill
			    the cell; `vectorEffect="non-scaling-stroke"` keeps stroke width
			    uniform under non-uniform scaling. */}
			<svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
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
			</svg>
		</div>
	);
}

/** Horizontal frequency axis — log scale, ticks under the chart. */
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
			{/* Top border line so ticks read as part of the chart frame. */}
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

	// First-compute progress aggregated across the per-source LTAS traces — a
	// shimmer + mean-fraction bar over the chart while any source first-computes.
	const progress = useFirstComputeProgress();

	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(DISABLED_CONTROL);
		}
	}, [onTransportControlChange]);

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-void">
			{/* Chart pane — dB axis on the left, chart in the middle, frequency
			    axis underneath. Runs flush to the pane's left edge (the dB axis
			    is the graph's own internal padding there); top, right and bottom
			    keep a `4`-unit inset for breathing room. */}
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
				{/* Horizontal frequency axis — aligned under the chart, offset to
				    the right by the dB-axis width so ticks line up with chart X. */}
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
