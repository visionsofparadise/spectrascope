import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartSvg, HorizontalGridlines, TracePolylines } from "../spectral/chartMarks";
import { ChartLayout, useChartView, type ChartAxis, type ChartCanvasBaseProps } from "../spectral/chartView";
import { useReportComputeState, type ComputeState } from "../spectral/firstComputeProgress";
import { useTraceCompute } from "../spectral/traceCompute";
import { computeWindowTransform } from "../useTimeViewport";
import { METRICS } from "../viewSettings";
import { buildPolylineSegments } from "./chartTrace";
import { useChromeSources } from "./viewAudio";
import type { Source } from "../source";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { LoudnessMetric, MetricSpec, ViewControlSettings } from "../viewSettings";
import type { LoudnessData, SpectralOptions } from "spectral-display";

const LOUDNESS_CONFIG: SpectralOptions["config"] = {
	spectrogram: false,
	loudness: true,
	truePeak: true,
};

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
	const { computeResult, renderable } = useTraceCompute(audioData, startMs, endMs, LOUDNESS_CONFIG);

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
			<TracePolylines segments={segments} color={color} />
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

interface ChartCanvasProps extends ChartCanvasBaseProps {
	readonly metric: MetricSpec;
}

function ChartCanvas({ chart, renderableSources, metric }: ChartCanvasProps) {
	const { committedStartMs, committedEndMs, startMs: liveStartMs, endMs: liveEndMs } = chart.viewport;
	const [loudnessMap, setLoudnessMap] = useState<Map<string, LoudnessData | null>>(() => new Map());

	const handleLoudnessData = useCallback((sourceId: string, data: LoudnessData | null) => {
		setLoudnessMap((previous) => {
			const next = new Map(previous);

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
			<HorizontalGridlines fractions={dbTicks.map((db) => dbToY(db, metric.axisMin))} />
			<ChartSvg>
				{renderableSources.map(({ source, audioData }) => (
					<SourceLoudnessTrace
						key={source.id}
						source={source}
						audioData={audioData}
						startMs={committedStartMs}
						endMs={committedEndMs}
						liveStartMs={liveStartMs}
						liveEndMs={liveEndMs}
						metric={metric}
						onLoudnessData={handleLoudnessData}
						onComputeState={chart.progress.handleComputeState}
					/>
				))}
			</ChartSvg>
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
	const { renderableSources, chromeAudio, layerColor } = useChromeSources(sources, sourceAudio);

	const metricSpec = useMemo(
		() => METRICS.find((entry) => entry.id === settings.loudnessMetric) ?? DEFAULT_METRIC,
		[settings.loudnessMetric],
	);

	const axis = useMemo<ChartAxis>(
		() => ({
			max: DB_MAX,
			min: metricSpec.axisMin,
			formatValue: (value) => `${value.toFixed(1)} dB`,
			emptyValue: "— dB",
		}),
		[metricSpec.axisMin],
	);

	const durationSec = chromeAudio.durationMs / 1000;

	const controlExtras = useMemo(
		() => ({
			selectionInSec: durationSec * 0.25,
			selectionOutSec: durationSec * 0.45,
			selectionInAmp: "-19.7 dB",
			selectionOutAmp: "-24.3 dB",
		}),
		[durationSec],
	);

	const chart = useChartView(chromeAudio, layerColor, axis, onTransportControlChange, controlExtras);

	const dbTicks = metricSpec.axisMin === -60 ? DB_TICKS_60 : DB_TICKS_40;

	return (
		<ChartLayout chart={chart} ticks={dbTicks} isEmpty={renderableSources.length === 0}>
			<ChartCanvas chart={chart} renderableSources={renderableSources} metric={metricSpec} />
		</ChartLayout>
	);
}
