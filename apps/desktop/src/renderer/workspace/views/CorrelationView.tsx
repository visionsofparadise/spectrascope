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


interface CorrelationViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const CORR_MAX = 1;
const CORR_MIN = -1;
const CORR_TICKS: ReadonlyArray<number> = [1, 0.5, 0, -0.5, -1];

function corrToY(corr: number): number {
	const clamped = Math.max(CORR_MIN, Math.min(CORR_MAX, corr));

	return (CORR_MAX - clamped) / (CORR_MAX - CORR_MIN);
}

interface SourceCorrelationTraceProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
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
	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	const chromeAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;

	const viewport = useTimeViewport(0, chromeAudio.durationMs);

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

	const minimapColor = renderableSources[0]?.source.layerColor ?? {
		primary: "#B8B8C0",
		secondary: "#44444C",
	};

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-void">
			<div className="flex min-h-0 flex-1 flex-col pr-4">
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
