import { useEffect, useMemo } from "react";
import type { Source } from "../source";
import { LinearDbAxis } from "../spectral/Axes";
import type { TransportControl } from "../Transport";
import type { AudioData } from "../spectral/types";
import { resolveVisibleSourceAudio } from "./viewAudio";

/**
 * FrequencyDistributionView — per-source long-term-average-spectrum (LTAS) lines
 * on a single chart. Frequency on X (log, 20 Hz → 20 kHz), magnitude on Y (dB,
 * -90 → 0). One polyline per visible source, drawn in `source.layerColor.primary`
 * at full opacity.
 *
 * **Placeholder synthetic LTAS curves.** Real magnitude-spectrum extraction from
 * `audioData` is out of first-pass scope — wiring against the existing
 * `useSpectralCompute` to derive a time-averaged spectrum (sum across all time
 * frames, normalize by frame count, convert to dB) is a follow-up plan. The
 * synthetic shape is a pink-ish slope `-10 * log10(freq / 1000) - 30` with
 * deterministic ±6 dB jitter seeded from `source.id` so the per-source curves
 * differ visibly without overlapping by coincidence.
 *
 * **View-level chrome scope** (Phase 8 judgment call, recorded in plan Notes):
 * - Kept: a single chart pane filling the workspace area, a minimal "FREQUENCY
 *   DISTRIBUTION" title strip at the top, and a small legend at the top-right
 *   listing the visible sources colored by `layerColor.primary`.
 * - Dropped: TimeRuler (no time dimension), the right-column display controls
 *   block (FFT/hop/grid mode are meaningless on a single static LTAS chart in
 *   first pass), FrequencyMinimap (no time scope to navigate), and the cursor
 *   readout chip (frequency-readout-on-hover is a follow-up).
 *
 * **Axis composition**: the existing `FrequencyAxis` and `DbAxis` from
 * `components/spectral/Axes.tsx` are oriented for a spectrogram (frequency on
 * the vertical edge, dB symmetric around zero). This view needs horizontal log
 * frequency along the bottom and a single-direction dB axis from -90 to 0 on
 * the left. Phase 9 promoted the linear dB axis to a shared helper
 * (`LinearDbAxis` in `components/spectral/Axes.tsx`) since LoudnessView is the
 * second consumer; this file imports it and passes its own `DB_TICKS` (0 →
 * -90). The horizontal log-frequency axis is unique to this view and stays
 * inlined as `HorizontalFrequencyAxis`.
 */

interface FrequencyDistributionViewProps {
	readonly sources: ReadonlyArray<Source>;
	/** Per-source PCM readers, keyed by `Source.id`. */
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const FREQ_MIN_HZ = 20;
const FREQ_MAX_HZ = 20000;
const DB_MIN = -90;
const DB_MAX = 0;
const CURVE_POINTS = 256;
const JITTER_AMPLITUDE_DB = 6;

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
 * has no playback in first pass — the LTAS is a static whole-clip aggregate.
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
 * Deterministic per-source seed derived from `source.id`. Cheap string hash
 * (djb2 variant) — collisions are tolerable; we just need different curves per
 * source across the seeded demo set.
 */
function seedFromId(id: string): number {
	let hash = 5381;

	for (let index = 0; index < id.length; index++) {
		hash = ((hash << 5) + hash + id.charCodeAt(index)) >>> 0;
	}

	return hash;
}

/**
 * Deterministic pseudo-random number generator (mulberry32). Returns a function
 * that yields a new value in [0, 1) on each call.
 */
function makeRng(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;

		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

/** Pink-ish baseline magnitude in dB at a given frequency. */
function baselineDb(freqHz: number): number {
	return -10 * Math.log10(freqHz / 1000) - 30;
}

/** Map a frequency (Hz) to a [0, 1] X fraction along the log axis. */
function freqToX(freqHz: number): number {
	const logMin = Math.log10(FREQ_MIN_HZ);
	const logMax = Math.log10(FREQ_MAX_HZ);

	return (Math.log10(freqHz) - logMin) / (logMax - logMin);
}

/** Map a magnitude (dB) to a [0, 1] Y fraction, top = 0 dB, bottom = -90 dB. */
function dbToY(db: number): number {
	const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));

	return (DB_MAX - clamped) / (DB_MAX - DB_MIN);
}

/**
 * Generate a deterministic synthetic LTAS curve for one source. CURVE_POINTS
 * samples spaced uniformly across the log-frequency range; each sample is the
 * pink-ish baseline plus seeded ±6 dB jitter, clamped to [-90, 0].
 */
function buildCurve(sourceId: string): ReadonlyArray<{ x: number; y: number }> {
	const rng = makeRng(seedFromId(sourceId));
	const logMin = Math.log10(FREQ_MIN_HZ);
	const logMax = Math.log10(FREQ_MAX_HZ);
	const points: Array<{ x: number; y: number }> = [];

	for (let pointIndex = 0; pointIndex < CURVE_POINTS; pointIndex++) {
		const fraction = pointIndex / (CURVE_POINTS - 1);
		const logHz = logMin + (logMax - logMin) * fraction;
		const freqHz = Math.pow(10, logHz);
		const jitter = (rng() - 0.5) * 2 * JITTER_AMPLITUDE_DB;
		const db = Math.max(DB_MIN, Math.min(DB_MAX, baselineDb(freqHz) + jitter));

		points.push({ x: freqToX(freqHz), y: dbToY(db) });
	}

	return points;
}

interface ChartCurveProps {
	readonly points: ReadonlyArray<{ x: number; y: number }>;
	readonly color: string;
}

function ChartCurve({ points, color }: ChartCurveProps) {
	const polylinePoints = useMemo(
		() => points.map((point) => `${point.x},${point.y}`).join(" "),
		[points],
	);

	return (
		<polyline points={polylinePoints} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
	);
}

interface ChartCanvasProps {
	readonly visibleSources: ReadonlyArray<Source>;
}

function ChartCanvas({ visibleSources }: ChartCanvasProps) {
	const curves = useMemo(
		() => visibleSources.map((source) => ({ id: source.id, color: source.layerColor.primary, points: buildCurve(source.id) })),
		[visibleSources],
	);

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
			<svg
				className="absolute inset-0 h-full w-full"
				viewBox="0 0 1 1"
				preserveAspectRatio="none"
			>
				{curves.map((curve) => (
					<ChartCurve key={curve.id} points={curve.points} color={curve.color} />
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
					<div key={tick.hz} className="absolute top-0" style={{ left: `${xPct}%`, transform: "translateX(-50%)" }}>
						<span className="absolute top-0 left-1/2 h-1.5 w-px -translate-x-1/2 bg-chrome-border" />
						<span className="absolute top-2 left-1/2 -translate-x-1/2 whitespace-nowrap">{tick.label}</span>
					</div>
				);
			})}
		</div>
	);
}

export function FrequencyDistributionView({ sources, sourceAudio, onTransportControlChange }: FrequencyDistributionViewProps) {
	// `sourceAudio` is part of the prop contract for view containers; the LTAS
	// curves are still synthetic placeholders, so only the *set* of sources
	// with decoded audio is consumed here. Real magnitude-spectrum extraction
	// against each source's PCM is a follow-up.
	const visibleSources = useMemo(
		() => resolveVisibleSourceAudio(sources, sourceAudio).map((entry) => entry.source),
		[sources, sourceAudio],
	);

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
						{visibleSources.length === 0 ? (
							<div className="flex h-full items-center justify-center bg-void">
								<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
							</div>
						) : (
							<ChartCanvas visibleSources={visibleSources} />
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
