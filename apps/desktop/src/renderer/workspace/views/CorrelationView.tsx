import { useCallback, useEffect, useMemo, useState } from "react";
import { useSpectralCompute } from "spectral-display";
import { LinearDbAxis, TimeRuler } from "../spectral/Axes";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { computeWindowTransform, useTimeViewport } from "../useTimeViewport";
import { buildPolylineSegments } from "./chartTrace";
import { EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { SourceWithAudio } from "./viewAudio";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl, TransportCursorReadout } from "../Transport";
import type { SpectralOptions } from "spectral-display";

/** Local `#RRGGBB` → `[r, g, b]` helper. Duplicates the per-view copies in the
 *  SourceRender-based views and `LoudnessView`. */
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
 * CorrelationView — per-source inter-channel correlation traces over time. One
 * polyline per visible source, drawn in `source.layerColor.primary`, against a
 * shared time axis. The Y axis is the fixed correlation range `+1 … -1`: `+1` =
 * mono-like (perfectly correlated), `0` = decorrelated / wide, `-1` = inverted
 * (mono-incompatible).
 *
 * The correlation envelope is a real `spectral-display` scan product — computed
 * by `useSpectralCompute` with `config.stereo: true`, surfaced on the `"ready"`
 * `ComputeResult` as `correlationEnvelope` (one value per visualization point,
 * 500 points/sec). The hook is called per-source via the `<SourceCorrelationTrace>`
 * sub-component (a hook must be called from a render function — one per source).
 *
 * The envelope is a static precomputed whole-clip curve, so this view carries
 * the normal transport (the playhead scrubs the static curve), like Loudness.
 */

interface CorrelationViewProps {
	readonly sources: ReadonlyArray<Source>;
	/** Per-source PCM readers, keyed by `Source.id`. */
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

/** Y axis runs the fixed correlation range, `+1` at the top, `-1` at the bottom. */
const CORR_MAX = 1;
const CORR_MIN = -1;
const CORR_TICKS: ReadonlyArray<number> = [1, 0.5, 0, -0.5, -1];

/** Map a correlation coefficient to a `[0, 1]` Y fraction (top = +1). */
function corrToY(corr: number): number {
	const clamped = Math.max(CORR_MIN, Math.min(CORR_MAX, corr));

	return (CORR_MAX - clamped) / (CORR_MAX - CORR_MIN);
}

/**
 * Sub-component that runs `useSpectralCompute` for one source with the stereo
 * scan products enabled, and renders the correlation polyline(s). The
 * spectrogram / loudness / true-peak pipelines are disabled — only the stereo
 * scan products are wanted, so the hook does the minimum work.
 */
interface SourceCorrelationTraceProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
	/** The view's live (gesture-following) window, mapped onto the held render. */
	readonly liveStartMs: number;
	readonly liveEndMs: number;
	readonly onComputeState?: (sourceId: string, state: ComputeState | null) => void;
}

function SourceCorrelationTrace({
	source,
	audioData,
	startMs,
	endMs,
	liveStartMs,
	liveEndMs,
	onComputeState,
}: SourceCorrelationTraceProps) {
	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			// Width/height are required but the correlation scan doesn't draw a
			// canvas — keep them minimal but non-zero so the engine still runs.
			// The query is windowed to the committed viewport so the envelope
			// follows the zoom.
			query: { startMs, endMs, width: 64, height: 64 },
			readSamples: audioData.readSamples,
			config: {
				spectrogram: false,
				loudness: false,
				truePeak: false,
				stereo: true,
			},
		}),
		[audioData.sampleRate, audioData.totalSamples, audioData.channels, audioData.readSamples, startMs, endMs],
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

	const envelope = renderable ? renderable.correlationEnvelope : null;

	const segments = useMemo(() => (envelope ? buildPolylineSegments(envelope, corrToY) : []), [envelope]);

	useReportComputeState(source.id, computeResult, onComputeState);

	if (!renderable || segments.length === 0) return null;

	const color = source.layerColor.primary;

	// Map the held render's window onto the live one so the trace follows the
	// gesture; SVG redraws synchronously with state, so no double-buffer is
	// needed. `transform-origin: left` matches the `computeWindowTransform`
	// scale/translate reference (viewBox left edge under `transform-box: view-box`).
	return (
		<g
			style={{
				transform: computeWindowTransform(renderable.query, {
					startMs: liveStartMs,
					endMs: liveEndMs,
				}),
				transformOrigin: "left",
			}}
		>
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
	readonly startMs: number;
	readonly endMs: number;
	readonly liveStartMs: number;
	readonly liveEndMs: number;
	readonly onComputeState: (sourceId: string, state: ComputeState | null) => void;
}

function ChartCanvas({ renderableSources, startMs, endMs, liveStartMs, liveEndMs, onComputeState }: ChartCanvasProps) {
	return (
		<div className="relative h-full w-full overflow-hidden bg-void">
			{/* Correlation gridlines — one horizontal rule per tick, all
			    `chrome-border-subtle` per the v1 mockup (uniform, no heavier
			    zero reference). */}
			{CORR_TICKS.map((corr) => {
				const yPct = corrToY(corr) * 100;

				return (
					<div
						key={`h${corr}`}
						className="pointer-events-none absolute left-0 right-0 h-px bg-chrome-border-subtle"
						style={{ top: `${yPct}%` }}
					/>
				);
			})}
			{/* Each trace carries its own gesture transform on its `<g>` (held
			    render's window → live window), so they swap independently as each
			    source's recompute lands. */}
			<svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
				{renderableSources.map(({ source, audioData }) => (
					<SourceCorrelationTrace
						key={source.id}
						source={source}
						audioData={audioData}
						startMs={startMs}
						endMs={endMs}
						liveStartMs={liveStartMs}
						liveEndMs={liveEndMs}
						onComputeState={onComputeState}
					/>
				))}
			</svg>
		</div>
	);
}

export function CorrelationView({ sources, sourceAudio, onTransportControlChange }: CorrelationViewProps) {
	// Visible sources that have decoded audio, paired with their `AudioData`.
	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	// Shared chrome (time ruler, minimap, duration) sizes against the first
	// renderable source's audio; a zero-duration fallback when none.
	const chromeAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;

	// Transient time viewport — the traces window their computes to the committed
	// window, so the envelope follows the zoom.
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

	const viewStartFrac = chromeAudio.durationMs > 0 ? viewport.startMs / chromeAudio.durationMs : 0;
	const viewEndFrac = chromeAudio.durationMs > 0 ? viewport.endMs / chromeAudio.durationMs : 1;

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
		amp: "— r",
	});

	// Cursor readout — time on X, correlation on Y. No frequency dimension, so
	// the readout publishes only `time` and `amp` (used here for the
	// correlation coefficient); the Transport renders just those two rows.
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

			const corr = CORR_MAX - yFrac * (CORR_MAX - CORR_MIN);

			setCursorReadout({ time, amp: `${corr.toFixed(2)} r` });
		},
		[viewport.committedStartMs, viewport.committedEndMs],
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
		}),
		[playing, positionSec, durationSec, onPlayToggle, onSeek, cursorReadout],
	);

	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(control);
		}
	}, [control, onTransportControlChange]);

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
			    edges — the time ruler, correlation axis and overview minimap are
			    the graph's own chrome there. Only the right edge keeps a `4`-unit
			    inset, matching LoudnessView. */}
			<div className="flex min-h-0 flex-1 flex-col pr-4">
				{/* Time ruler at the top — offset right by the axis width so its
				    ticks align with the plot's X. */}
				<div className="flex shrink-0">
					<div className="w-10 shrink-0 bg-void" />
					<div className="min-w-0 flex-1">
						<TimeRuler startMs={viewport.committedStartMs} endMs={viewport.committedEndMs} />
					</div>
				</div>
				<div className="flex min-h-0 flex-1">
					<LinearDbAxis ticks={CORR_TICKS} />
					<div
						ref={viewport.wheelHandlers.ref}
						className="relative min-w-0 flex-1"
						onMouseMove={handleChartMouseMove}
					>
						{renderableSources.length === 0 ? (
							<div className="flex h-full items-center justify-center bg-void">
								<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
							</div>
						) : (
							<>
								<ChartCanvas
									renderableSources={renderableSources}
									startMs={viewport.committedStartMs}
									endMs={viewport.committedEndMs}
									liveStartMs={viewport.startMs}
									liveEndMs={viewport.endMs}
									onComputeState={progress.handleComputeState}
								/>
								{progress.firstComputing && <ComputeProgress fraction={progress.fraction} />}
							</>
						)}
					</div>
				</div>
				{/* Bottom horizontal minimap — overview scroll strip, offset right
				    by the axis width so it sits under the plot. Flush to the pane
				    bottom so the gap to the Transport matches the other views. */}
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
