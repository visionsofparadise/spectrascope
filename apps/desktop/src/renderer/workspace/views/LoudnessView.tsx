import { useCallback, useEffect, useMemo, useState } from "react";
import { useSpectralCompute } from "spectral-display";
import { LinearDbAxis, TimeRuler } from "../spectral/Axes";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { computeWindowTransform, useTimeViewport } from "../useTimeViewport";
import { METRICS } from "../viewSettings";
import { buildPolylineSegments } from "./chartTrace";
import { EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { SourceWithAudio } from "./viewAudio";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl, TransportCursorReadout } from "../Transport";
import type { LoudnessMetric, MetricSpec, ViewControlSettings } from "../viewSettings";
import type { LoudnessData, SpectralOptions } from "spectral-display";

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

interface LoudnessViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
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

function isScalarMetric(metric: LoudnessMetric): boolean {
	return metric === "truePeak" || metric === "samplePeak" || metric === "integrated";
}

function scalarMetricValue(
	data: LoudnessData,
	metric: LoudnessMetric,
): { readonly value: number; readonly text: string } | null {
	if (metric === "integrated") {
		return { value: data.integratedLufs, text: formatLufs(data.integratedLufs) };
	}

	if (metric === "truePeak") {
		const tp = data.truePeakDb ?? data.peakDb;

		return { value: tp, text: formatDbTp(tp) };
	}

	if (metric === "samplePeak") {
		return { value: data.peakDb, text: formatDbFs(data.peakDb) };
	}

	return null;
}

interface SourceLoudnessTraceProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
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
			query: { startMs, endMs, width: 64, height: 64 },
			readSamples: audioData.readSamples,
			config: {
				spectrogram: false,
				loudness: true,
				truePeak: true,
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

	const transformStyle = {
		transform: computeWindowTransform(renderable.query, {
			startMs: liveStartMs,
			endMs: liveEndMs,
		}),
		transformOrigin: "left" as const,
	};

	if (isScalarMetric(metric.id)) {
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
	const segments = buildPolylineSegments(series, (value) => dbToY(mapValueToDb(value), metric.axisMin));

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
	const [loudnessMap, setLoudnessMap] = useState<Map<string, LoudnessData | null>>(() => new Map());

	const handleLoudnessData = useCallback((sourceId: string, data: LoudnessData | null) => {
		setLoudnessMap((prev) => {
			const next = new Map(prev);

			if (data === null) {
				next.delete(sourceId);
			} else {
				next.set(sourceId, data);
			}

			return next;
		});
	}, []);

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
			<svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
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

export function LoudnessView({ sources, sourceAudio, settings, onTransportControlChange }: LoudnessViewProps) {
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

	const metricSpec = useMemo(
		() => METRICS.find((entry) => entry.id === settings.loudnessMetric) ?? DEFAULT_METRIC,
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
					<LinearDbAxis ticks={dbTicks} />
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
									metric={metricSpec}
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
