import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartSvg, HorizontalGridlines, TracePolylines } from "../spectral/chartMarks";
import { ChartLayout, useChartView, type ChartAxis, type ChartCanvasBaseProps } from "../spectral/chartView";
import { useReportComputeState } from "../spectral/firstComputeProgress";
import { useTraceCompute } from "../spectral/traceCompute";
import { computeWindowTransform } from "../useTimeViewport";
import { METRICS } from "../viewSettings";
import { buildPolylineSegments } from "./chartTrace";
import { useTimelineChromeSources } from "./viewAudio";
import type { Source } from "../source";
import type { SourceViewProps } from "./viewProps";
import type { ChartTraceProps } from "../spectral/chartTraceProps";
import type { ChartReadoutTrace } from "../spectral/useChartReadouts";
import type { LoudnessMetric, MetricSpec, ViewControlSettings } from "../viewSettings";
import type { LoudnessData, SpectralOptions, SpectralQuery } from "spectral-display";

const LOUDNESS_CONFIG: SpectralOptions["config"] = {
	spectrogram: false,
	loudness: true,
	truePeak: true,
};

interface LoudnessViewProps extends SourceViewProps {
	readonly settings: ViewControlSettings;
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

interface SourceLoudnessTraceProps extends ChartTraceProps {
	readonly metric: MetricSpec;
	readonly onLoudnessData: (sourceId: string, data: LoudnessData | null, query?: SpectralQuery) => void;
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
	onTraceChange,
}: SourceLoudnessTraceProps) {
	const { computeResult, renderable } = useTraceCompute(
		audioData,
		startMs,
		endMs,
		LOUDNESS_CONFIG,
		source.id,
		source.timelineOffsetMs,
	);

	const loudnessData = renderable ? renderable.loudnessData : null;
	const readout = useMemo<ChartReadoutTrace | null>(() => {
		if (!renderable || !loudnessData) return null;

		const scalar = scalarMetricValue(loudnessData, metric.id);
		const series = pickSeriesForMetric(loudnessData, metric.id);
		const values = scalar
			? scalar.value
			: series
				? metric.id === "rms"
					? series.map((value) => (value > 0 ? 20 * Math.log10(value) : -Infinity))
					: series
				: null;

		if (values === null) return null;

		const units =
			metric.id === "integrated" || metric.id === "momentary" || metric.id === "shortTerm"
				? "LUFS"
				: metric.id === "truePeak"
					? "dBTP"
					: "dBFS";

		return {
			sourceId: source.id,
			sourceName: source.name,
			query: renderable.query,
			values,
			valueToY: (value) => dbToY(value, metric.axisMin),
			formatValue: (value) => (value === -Infinity ? "−∞" : value.toFixed(1)),
			amplitudeLabel: `${scalar ? `Analyzed window ${(renderable.query.startMs / 1000).toFixed(3)}–${(renderable.query.endMs / 1000).toFixed(3)} s ` : ""}${metric.label} ${units}`,
		};
	}, [source.id, source.name, renderable, loudnessData, metric]);

	useEffect(() => {
		onTraceChange(source.id, readout);

		return () => onTraceChange(source.id, null);
	}, [source.id, readout, onTraceChange]);

	useEffect(() => {
		onLoudnessData(source.id, loudnessData, renderable?.query);

		return () => {
			onLoudnessData(source.id, null);
		};
	}, [source.id, loudnessData, renderable?.query, onLoudnessData]);

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
	readonly loudnessMap: ReadonlyMap<string, { data: LoudnessData; query?: SpectralQuery }>;
	readonly metric: MetricSpec;
}

function ScalarLabels({ visibleSources, loudnessMap, metric }: ScalarLabelsProps) {
	return (
		<>
			{visibleSources.map((source) => {
				const measurement = loudnessMap.get(source.id);

				if (!measurement) return null;

				const scalar = scalarMetricValue(measurement.data, metric.id);

				if (!scalar || !Number.isFinite(scalar.value)) return null;

				const yPct = dbToY(scalar.value, metric.axisMin) * 100;

				return (
					<div
						key={source.id}
						className="pointer-events-none absolute right-2 -translate-y-1/2 whitespace-nowrap font-technical text-[length:var(--text-xs)] tabular-nums"
						style={{ top: `${yPct}%`, color: source.layerColor.primary }}
					>
						{scalar.text}
						{measurement.query && (
							<span className="ml-2 text-chrome-text-secondary">
								Analyzed window {(measurement.query.startMs / 1000).toFixed(3)}–
								{(measurement.query.endMs / 1000).toFixed(3)} s
							</span>
						)}
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
	const [loudnessMap, setLoudnessMap] = useState<Map<string, { data: LoudnessData; query?: SpectralQuery }>>(
		() => new Map(),
	);

	const handleLoudnessData = useCallback((sourceId: string, data: LoudnessData | null, query?: SpectralQuery) => {
		setLoudnessMap((previous) => {
			const next = new Map(previous);

			if (data === null) {
				next.delete(sourceId);
			} else {
				next.set(sourceId, { data, query });
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
						onTraceChange={chart.onTraceChange}
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
	const { renderableSources, chromeAudio, layerColor } = useTimelineChromeSources(sources, sourceAudio);

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

	const chart = useChartView(chromeAudio, layerColor, axis, onTransportControlChange);

	const dbTicks = metricSpec.axisMin === -60 ? DB_TICKS_60 : DB_TICKS_40;

	return (
		<ChartLayout chart={chart} ticks={dbTicks} isEmpty={renderableSources.length === 0}>
			<ChartCanvas chart={chart} renderableSources={renderableSources} metric={metricSpec} />
		</ChartLayout>
	);
}
