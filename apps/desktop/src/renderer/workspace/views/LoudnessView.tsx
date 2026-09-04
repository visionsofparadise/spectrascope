import { useCallback, useEffect, useMemo, useState } from "react";
import { useSpectralCompute } from "spectral-display";
import type { LoudnessData, SpectralOptions } from "spectral-display";
import type { Source } from "../source";
import { LinearDbAxis, TimeRuler } from "../spectral/Axes";
import { ComputeProgress } from "../spectral/ComputeProgress";
import {
	useFirstComputeProgress,
	useReportComputeState,
} from "../spectral/firstComputeProgress";
import type { ComputeState } from "../spectral/firstComputeProgress";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { computeWindowTransform, useTimeViewport } from "../useTimeViewport";
import type {
	TransportControl,
	TransportCursorReadout,
} from "../Transport";
import type { AudioData } from "../spectral/types";
import { METRICS } from "../viewSettings";
import type {
	LoudnessMetric,
	MetricSpec,
	ViewControlSettings,
} from "../viewSettings";
import { buildPolylineSegments } from "./chartTrace";
import { EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";
import type { SourceWithAudio } from "./viewAudio";

/** Local `#RRGGBB` → `[r, g, b]` helper. Duplicates the per-view copies in the
 *  SourceRender-based views. */
function hexToRgb255(hex: string): [number, number, number] {
	const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
	const expanded =
		cleaned.length === 3
			? cleaned
					.split("")
					.map((char) => `${char}${char}`)
					.join("")
			: cleaned;
	const value = Number.parseInt(expanded, 16);

	if (Number.isNaN(value) || expanded.length !== 6) {
		return [184, 184, 192];
	}

	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * LoudnessView — plots one of six loudness metrics (True peak / Sample peak /
 * Integrated / Momentary / Short term / RMS), chosen via the transport's
 * Metric dropdown and supplied as `settings.loudnessMetric`. Momentary / Short
 * term / RMS render one polyline per visible source against a shared time axis,
 * drawn in `source.layerColor.primary`. True peak, Sample peak and Integrated
 * are *scalar* metrics — a single whole-clip value each — so they draw a flat
 * horizontal line per source plus a labeled readout at the right edge.
 *
 * Real loudness data comes from `useSpectralCompute` in the `spectral-display`
 * package, called per-source via the `<SourceLoudnessTrace>` sub-component (a
 * hook must be called from a render function — one per source per metric).
 */

interface LoudnessViewProps {
	readonly sources: ReadonlyArray<Source>;
	/** Per-source PCM readers, keyed by `Source.id`. */
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	/** Shared display-control settings — supplies the active loudness metric. */
	readonly settings: ViewControlSettings;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const DEFAULT_METRIC: MetricSpec = METRICS[2] ?? {
	id: "integrated",
	label: "Integrated",
	axisMin: -40,
};

const DB_MAX = 0;
const DB_TICKS_60: ReadonlyArray<number> = [0, -10, -20, -30, -40, -50, -60];
const DB_TICKS_40: ReadonlyArray<number> = [0, -5, -10, -15, -20, -25, -30, -35, -40];

/** Convert an amplitude (0..1) sample to dB, floored to keep -Infinity out. */
function ampToDb(amp: number, floorDb: number): number {
	if (amp <= 0 || !Number.isFinite(amp)) return floorDb;

	const db = 20 * Math.log10(amp);

	return db < floorDb ? floorDb : db;
}

function dbToY(db: number, axisMin: number): number {
	const clamped = Math.max(axisMin, Math.min(DB_MAX, db));

	return (DB_MAX - clamped) / (DB_MAX - axisMin);
}

function formatLufs(lufs: number): string {
	if (!Number.isFinite(lufs)) return "— LUFS";

	return `${lufs.toFixed(1)} LUFS`;
}

function formatDbTp(db: number): string {
	if (!Number.isFinite(db)) return "— dBTP";

	return `${db.toFixed(1)} dBTP`;
}

function formatDbFs(db: number): string {
	if (!Number.isFinite(db)) return "— dBFS";

	return `${db.toFixed(1)} dBFS`;
}

/**
 * True peak, Sample peak and Integrated are *scalar* metrics — a single value
 * for the whole clip, not a time series. True peak is the clip's maximum
 * inter-sample (oversampled) peak; Sample peak is the maximum raw-sample peak;
 * Integrated LUFS is the gated whole-programme loudness. Each renders as a flat
 * horizontal line plus a right-edge label, so they read as constant across the
 * source (they are). The other three metrics are genuine time series.
 */
function isScalarMetric(metric: LoudnessMetric): boolean {
	return (
		metric === "truePeak" || metric === "samplePeak" || metric === "integrated"
	);
}

function scalarMetricValue(
	data: LoudnessData,
	metric: LoudnessMetric,
): { readonly value: number; readonly text: string } | null {
	if (metric === "integrated") {
		return { value: data.integratedLufs, text: formatLufs(data.integratedLufs) };
	}

	if (metric === "truePeak") {
		// Oversampled inter-sample peak; fall back to the sample peak when the
		// engine didn't compute true-peak for this run.
		const tp = data.truePeakDb ?? data.peakDb;

		return { value: tp, text: formatDbTp(tp) };
	}

	if (metric === "samplePeak") {
		return { value: data.peakDb, text: formatDbFs(data.peakDb) };
	}

	return null;
}

/**
 * Sub-component that runs `useSpectralCompute` for one source with the
 * loudness pipeline enabled, and renders the polyline(s) for the active
 * metric. Bubbles `LoudnessData` up to the parent (only used by the Integrated
 * tab, which renders a right-edge text label per source).
 */
interface SourceLoudnessTraceProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
	/** The view's live (gesture-following) window, mapped onto the held render. */
	readonly liveStartMs: number;
	readonly liveEndMs: number;
	readonly metric: MetricSpec;
	readonly onLoudnessData: (sourceId: string, data: LoudnessData | null) => void;
	readonly onComputeState?: (sourceId: string, state: ComputeState | null) => void;
}

function SourceLoudnessTrace({
	source,
	audioData,
	startMs,
	endMs,
	liveStartMs,
	liveEndMs,
	metric,
	onLoudnessData,
	onComputeState,
}: SourceLoudnessTraceProps) {
	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			// Width/height are required but the loudness pipeline doesn't draw a
			// canvas — keep them minimal but non-zero so the engine still runs.
			// The query is windowed to the committed viewport so the metric follows
			// the zoom; loudness pins density at 500 pts/sec regardless.
			query: { startMs, endMs, width: 64, height: 64 },
			readSamples: audioData.readSamples,
			config: {
				spectrogram: false,
				loudness: true,
				truePeak: true,
			},
		}),
		[
			audioData.sampleRate,
			audioData.totalSamples,
			audioData.channels,
			audioData.readSamples,
			startMs,
			endMs,
		],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	// The result whose data is drawn: the fresh `ready` result, else the last
	// good one held through a recompute or error. Null only before any result.
	const renderable =
		computeResult.status === "ready"
			? computeResult
			: computeResult.status === "computing" || computeResult.status === "error"
				? computeResult.previous
				: null;

	const loudnessData = renderable ? renderable.loudnessData : null;

	useEffect(() => {
		onLoudnessData(source.id, loudnessData);

		return () => {
			onLoudnessData(source.id, null);
		};
	}, [source.id, loudnessData, onLoudnessData]);

	useReportComputeState(source.id, computeResult, onComputeState);

	if (!renderable || !loudnessData) return null;

	const color = source.layerColor.primary;

	// Map the held render's window onto the live one so the trace follows the
	// gesture; SVG redraws synchronously with state, so no double-buffer needed.
	const transformStyle = {
		transform: computeWindowTransform(renderable.query, {
			startMs: liveStartMs,
			endMs: liveEndMs,
		}),
		transformOrigin: "left" as const,
	};

	if (isScalarMetric(metric.id)) {
		// Scalar metric (TP / Integrated) — a flat horizontal line at the
		// whole-clip value.
		const scalar = scalarMetricValue(loudnessData, metric.id);

		if (!scalar) return null;

		const y = dbToY(scalar.value, metric.axisMin);

		if (!Number.isFinite(y)) return null;

		return (
			<g style={transformStyle}>
				<polyline
					points={`0,${y} 1,${y}`}
					fill="none"
					stroke={color}
					strokeWidth={1.5}
					vectorEffect="non-scaling-stroke"
				/>
			</g>
		);
	}

	const series = pickSeriesForMetric(loudnessData, metric.id);

	if (!series) return null;

	const mapValueToDb = mapperForMetric(metric.id, metric.axisMin);
	const segments = buildPolylineSegments(series, (value) =>
		dbToY(mapValueToDb(value), metric.axisMin),
	);

	return (
		<g style={transformStyle}>
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

function pickSeriesForMetric(data: LoudnessData, metric: LoudnessMetric): Float32Array | null {
	switch (metric) {
		case "momentary":
			return data.momentaryLufs;
		case "shortTerm":
			return data.shortTermLufs;
		case "rms":
			return data.rmsEnvelope;
		case "truePeak":
		case "samplePeak":
		case "integrated":
		default:
			return null;
	}
}

/**
 * Map a raw series value to dB for each metric. The RMS envelope is a linear
 * amplitude in [0, 1] — convert via `20 * log10`. The LUFS series are already
 * in LUFS (dB-domain) — pass through, but clamp -Infinity to the floor.
 */
function mapperForMetric(metric: LoudnessMetric, floorDb: number): (value: number) => number {
	if (metric === "rms") {
		return (value: number) => ampToDb(value, floorDb);
	}

	return (value: number) => {
		if (!Number.isFinite(value)) return floorDb;

		return value < floorDb ? floorDb : value;
	};
}

interface ScalarLabelsProps {
	readonly visibleSources: ReadonlyArray<Source>;
	readonly loudnessMap: ReadonlyMap<string, LoudnessData | null>;
	readonly metric: MetricSpec;
}

/**
 * Right-edge labels for the scalar tabs (True peak / Sample peak /
 * Integrated). One label per source, positioned at its whole-clip value, in
 * its `primary`
 * color. Labels are absolute-positioned over the chart so they ride alongside
 * the flat lines.
 */
function ScalarLabels({ visibleSources, loudnessMap, metric }: ScalarLabelsProps) {
	return (
		<>
			{visibleSources.map((source) => {
				const data = loudnessMap.get(source.id);

				if (!data) return null;

				const scalar = scalarMetricValue(data, metric.id);

				if (!scalar || !Number.isFinite(scalar.value)) return null;

				const yPct = dbToY(scalar.value, metric.axisMin) * 100;

				return (
					<div
						key={source.id}
						className="pointer-events-none absolute right-2 -translate-y-1/2 whitespace-nowrap font-technical text-[length:var(--text-xs)] tabular-nums"
						style={{ top: `${yPct}%`, color: source.layerColor.primary }}
					>
						{scalar.text}
					</div>
				);
			})}
		</>
	);
}

interface ChartCanvasProps {
	readonly renderableSources: ReadonlyArray<SourceWithAudio>;
	readonly metric: MetricSpec;
	readonly startMs: number;
	readonly endMs: number;
	readonly liveStartMs: number;
	readonly liveEndMs: number;
	readonly onComputeState: (sourceId: string, state: ComputeState | null) => void;
}

function ChartCanvas({
	renderableSources,
	metric,
	startMs,
	endMs,
	liveStartMs,
	liveEndMs,
	onComputeState,
}: ChartCanvasProps) {
	const [loudnessMap, setLoudnessMap] = useState<Map<string, LoudnessData | null>>(
		() => new Map(),
	);

	const handleLoudnessData = useCallback(
		(sourceId: string, data: LoudnessData | null) => {
			setLoudnessMap((prev) => {
				const next = new Map(prev);

				if (data === null) {
					next.delete(sourceId);
				} else {
					next.set(sourceId, data);
				}

				return next;
			});
		},
		[],
	);

	const dbTicks = metric.axisMin === -60 ? DB_TICKS_60 : DB_TICKS_40;

	return (
		<div className="relative h-full w-full overflow-hidden bg-void">
			{dbTicks.map((db) => {
				const yPct = dbToY(db, metric.axisMin) * 100;

				return (
					<div
						key={`h${db}`}
						className="pointer-events-none absolute left-0 right-0 h-px bg-chrome-border-subtle"
						style={{ top: `${yPct}%` }}
					/>
				);
			})}
			{/* Each trace carries its own gesture transform on its `<g>` (held
			    render's window → live window), so they swap independently as each
			    source's recompute lands. */}
			<svg
				className="absolute inset-0 h-full w-full"
				viewBox="0 0 1 1"
				preserveAspectRatio="none"
			>
				{renderableSources.map(({ source, audioData }) => (
					<SourceLoudnessTrace
						key={source.id}
						source={source}
						audioData={audioData}
						startMs={startMs}
						endMs={endMs}
						liveStartMs={liveStartMs}
						liveEndMs={liveEndMs}
						metric={metric}
						onLoudnessData={handleLoudnessData}
						onComputeState={onComputeState}
					/>
				))}
			</svg>
			{isScalarMetric(metric.id) && (
				<ScalarLabels
					visibleSources={renderableSources.map((entry) => entry.source)}
					loudnessMap={loudnessMap}
					metric={metric}
				/>
			)}
		</div>
	);
}

export function LoudnessView({
	sources,
	sourceAudio,
	settings,
	onTransportControlChange,
}: LoudnessViewProps) {
	// Visible sources that have decoded audio, paired with their `AudioData`.
	const renderableSources = useMemo(
		() => resolveVisibleSourceAudio(sources, sourceAudio),
		[sources, sourceAudio],
	);

	// Shared chrome (time ruler, minimap, duration) sizes against the first
	// renderable source's audio; a zero-duration fallback when none.
	const chromeAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;

	// Transient time viewport — the traces window their computes to the committed
	// window, so the metric follows the zoom.
	const viewport = useTimeViewport(0, chromeAudio.durationMs);

	// First-compute progress aggregated across the traces — a shimmer + mean-
	// fraction bar over the chart while any source is first-computing.
	const progress = useFirstComputeProgress();

	const setViewportToFraction = useCallback(
		(fraction: number) => {
			const centerMs = fraction * chromeAudio.durationMs;
			const span = viewport.endMs - viewport.startMs;

			viewport.setViewport({ startMs: centerMs - span / 2, endMs: centerMs + span / 2 });
		},
		[chromeAudio.durationMs, viewport],
	);

	const viewStartFrac =
		chromeAudio.durationMs > 0 ? viewport.startMs / chromeAudio.durationMs : 0;
	const viewEndFrac =
		chromeAudio.durationMs > 0 ? viewport.endMs / chromeAudio.durationMs : 1;

	const metricSpec = useMemo(
		() =>
			METRICS.find((entry) => entry.id === settings.loudnessMetric) ??
			DEFAULT_METRIC,
		[settings.loudnessMetric],
	);

	const [playing, setPlaying] = useState(false);
	const [positionSec, setPositionSec] = useState(0);
	const durationSec = chromeAudio.durationMs / 1000;

	const onPlayToggle = useCallback(() => {
		setPlaying((prev) => !prev);
	}, []);

	const onSeek = useCallback(
		(sec: number) => {
			setPositionSec(Math.max(0, Math.min(durationSec, sec)));
		},
		[durationSec],
	);

	const [cursorReadout, setCursorReadout] = useState<TransportCursorReadout>({
		time: "00:00.000",
		amp: "— dB",
	});

	// Cursor readout — time on X, dB on Y. Loudness has no frequency dimension,
	// so the readout publishes only `time` and `amp`; the Transport renders just
	// those two rows (its `Freq` row is suppressed when `freq` is absent).
	const handleChartMouseMove = useCallback(
		(ev: React.MouseEvent<HTMLDivElement>) => {
			const rect = ev.currentTarget.getBoundingClientRect();

			if (rect.width <= 0 || rect.height <= 0) return;

			const xFrac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
			const yFrac = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));

			const windowMs = viewport.committedEndMs - viewport.committedStartMs;
			const totalSec = (viewport.committedStartMs + xFrac * windowMs) / 1000;
			const mins = Math.floor(totalSec / 60);
			const secs = Math.floor(totalSec % 60);
			const ms = Math.floor((totalSec % 1) * 1000);
			const time = `${mins.toString().padStart(2, "0")}:${secs
				.toString()
				.padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

			const db = DB_MAX - yFrac * (DB_MAX - metricSpec.axisMin);

			setCursorReadout({ time, amp: `${db.toFixed(1)} dB` });
		},
		[viewport.committedStartMs, viewport.committedEndMs, metricSpec.axisMin],
	);

	const control = useMemo<TransportControl>(
		() => ({
			disabled: false,
			playing,
			positionSec,
			durationSec,
			onPlayToggle,
			onSeek,
			cursorReadout,
			// Demo selection range (0.25–0.45 of duration) — surfaces as the
			// transport's In / Out columns.
			selectionInSec: durationSec * 0.25,
			selectionOutSec: durationSec * 0.45,
			selectionInAmp: "-19.7 dB",
			selectionOutAmp: "-24.3 dB",
		}),
		[playing, positionSec, durationSec, onPlayToggle, onSeek, cursorReadout],
	);

	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(control);
		}
	}, [control, onTransportControlChange]);

	const dbTicks = metricSpec.axisMin === -60 ? DB_TICKS_60 : DB_TICKS_40;

	// The overview minimap renders a single waveform; with N sources the colour
	// choice is arbitrary, so use the first renderable source's primary (a
	// neutral chrome pair when nothing is renderable).
	const minimapColor = renderableSources[0]?.source.layerColor ?? {
		primary: "#B8B8C0",
		secondary: "#44444C",
	};

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-void">
			{/* The chart group runs flush to the pane's top, left and bottom
			    edges — the time ruler, dB axis and overview minimap are the
			    graph's own chrome there. Only the right edge keeps a `4`-unit
			    inset. Bottom-flush keeps the minimap-to-Transport gap identical
			    to the SourceStrip views. */}
			<div className="flex min-h-0 flex-1 flex-col pr-4">
				{/* Time ruler at the top — like the waveform views. Offset right
				    by the dB-axis width so its ticks align with the plot's X. */}
				<div className="flex shrink-0">
					<div className="w-10 shrink-0 bg-void" />
					<div className="min-w-0 flex-1">
						<TimeRuler startMs={viewport.committedStartMs} endMs={viewport.committedEndMs} />
					</div>
				</div>
				<div className="flex min-h-0 flex-1">
					<LinearDbAxis ticks={dbTicks} />
					<div
						ref={viewport.wheelHandlers.ref}
						className="relative min-w-0 flex-1"
						onMouseMove={handleChartMouseMove}
					>
						{renderableSources.length === 0 ? (
							<div className="flex h-full items-center justify-center bg-void">
								<p className="font-body text-sm text-chrome-text-secondary">
									No visible sources.
								</p>
							</div>
						) : (
							<>
								<ChartCanvas
									renderableSources={renderableSources}
									metric={metricSpec}
									startMs={viewport.committedStartMs}
									endMs={viewport.committedEndMs}
									liveStartMs={viewport.startMs}
									liveEndMs={viewport.endMs}
									onComputeState={progress.handleComputeState}
								/>
								{progress.firstComputing && (
									<ComputeProgress fraction={progress.fraction} />
								)}
							</>
						)}
					</div>
				</div>
				{/* Bottom horizontal minimap — overview scroll strip, offset
				    right by the dB-axis width so it sits under the plot. Flush to
				    the pane bottom so the gap to the Transport matches the other
				    views. */}
				<div className="flex shrink-0">
					<div className="w-10 shrink-0 bg-void" />
					<div className="min-w-0 flex-1">
						<MinimapDisplay
							audioData={chromeAudio}
							viewStartFrac={viewStartFrac}
							viewEndFrac={viewEndFrac}
							waveformColor={hexToRgb255(minimapColor.primary)}
							onScrubToFraction={setViewportToFraction}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
