import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartSvg, HorizontalGridlines, TracePolylines } from "../spectral/chartMarks";
import { ChartLayout, useChartView, type ChartAxis, type ChartCanvasBaseProps } from "../spectral/chartView";
import { useReportComputeState } from "../spectral/firstComputeProgress";
import { useTraceCompute } from "../spectral/traceCompute";
import { visibleValueTicksOf } from "../spectral/valueTicks";
import { computeWindowTransform } from "../useTimeViewport";
import { axisFractionOf } from "../utils/axisRange";
import { METRICS } from "../viewSettings";
import { buildPolylineSegments } from "./chartTrace";
import { useTimelineChromeSources } from "./viewAudio";
import type { SourceWithAudio } from "./viewAudio";
import type { SourceViewProps } from "./viewProps";
import type { ChartTraceProps } from "../spectral/chartTraceProps";
import type { ChartReadoutTrace } from "../spectral/useChartReadouts";
import type { AxisRange } from "../utils/axisRange";
import type { LoudnessMetric, MetricSpec, ViewControlSettings } from "../viewSettings";
import type { LoudnessData, SpectralOptions } from "spectral-display";

const LOUDNESS_CONFIG: SpectralOptions["config"] = {
	spectrogram: false,
	loudness: true,
	truePeak: true,
};

interface LoudnessViewProps extends SourceViewProps {
	readonly settings: ViewControlSettings;
}

const DEFAULT_METRIC: MetricSpec = METRICS[0] ?? {
	id: "momentary",
	label: "Momentary",
	axisMin: -40,
};

const DB_MAX = 0;
const DB_TICK_COUNT = 8;

function ampToDb(amp: number, floorDb: number): number {
	if (amp <= 0 || !Number.isFinite(amp)) return floorDb;

	const db = 20 * Math.log10(amp);

	return db < floorDb ? floorDb : db;
}

function dbToY(db: number, axisMin: number): number {
	const clamped = Math.max(axisMin, Math.min(DB_MAX, db));

	return (DB_MAX - clamped) / (DB_MAX - axisMin);
}

export interface LoudnessStripValues {
	readonly integrated: number;
	readonly truePeak: number;
	readonly samplePeak: number;
}

export function loudnessStripValuesOf(data: LoudnessData): LoudnessStripValues {
	return {
		integrated: data.integratedLufs,
		truePeak: data.truePeakDb ?? data.peakDb,
		samplePeak: data.peakDb,
	};
}

export function stripLinePositionOf(value: number, axisMin: number, range: AxisRange): number | null {
	if (!Number.isFinite(value)) return null;

	const fraction = (DB_MAX - value) / (DB_MAX - axisMin);

	if (fraction < 0 || fraction > 1) return null;

	const position = axisFractionOf(fraction, range);

	return position >= 0 && position <= 1 ? position : null;
}

interface SourceLoudnessTraceProps extends ChartTraceProps {
	readonly metric: MetricSpec;
	readonly onLoudnessData: (sourceId: string, data: LoudnessData | null) => void;
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

		const series = pickSeriesForMetric(loudnessData, metric.id);
		const values =
			metric.id === "rms" ? series.map((value) => (value > 0 ? 20 * Math.log10(value) : -Infinity)) : series;

		return {
			sourceId: source.id,
			query: renderable.query,
			values,
			valueToY: (value) => dbToY(value, metric.axisMin),
			formatValue: (value) => (value === -Infinity ? "−∞" : value.toFixed(1)),
		};
	}, [source.id, renderable, loudnessData, metric]);

	useEffect(() => {
		onTraceChange(source.id, readout);

		return () => onTraceChange(source.id, null);
	}, [source.id, readout, onTraceChange]);

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

	const series = pickSeriesForMetric(loudnessData, metric.id);
	const mapValueToDb = mapperForMetric(metric.id, metric.axisMin);
	const segments = buildPolylineSegments(series, (value) => dbToY(mapValueToDb(value), metric.axisMin));

	return (
		<g style={transformStyle}>
			<TracePolylines segments={segments} color={color} />
		</g>
	);
}

function pickSeriesForMetric(data: LoudnessData, metric: LoudnessMetric): Float32Array {
	switch (metric) {
		case "momentary":
			return data.momentaryLufs;
		case "shortTerm":
			return data.shortTermLufs;
		case "rms":
			return data.rmsEnvelope;
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

const LOUDNESS_STRIPS: ReadonlyArray<{ readonly id: keyof LoudnessStripValues; readonly label: string }> = [
	{ id: "integrated", label: "Int" },
	{ id: "truePeak", label: "TP" },
	{ id: "samplePeak", label: "SP" },
];

interface LoudnessStripsProps {
	readonly renderableSources: ReadonlyArray<SourceWithAudio>;
	readonly loudnessMap: ReadonlyMap<string, LoudnessData>;
	readonly metric: MetricSpec;
	readonly range: AxisRange;
}

function LoudnessStrips({ renderableSources, loudnessMap, metric, range }: LoudnessStripsProps) {
	const dbTicks = visibleValueTicksOf(metric.axisMin, DB_MAX, range, DB_TICK_COUNT);

	return (
		<div className="mr-4 flex shrink-0 gap-4">
			{LOUDNESS_STRIPS.map((strip) => (
				<div key={strip.id} className="relative w-[50px] shrink-0 overflow-hidden bg-void">
					<HorizontalGridlines fractions={dbTicks.map((db) => dbToY(db, metric.axisMin))} range={range} />
					{renderableSources.map(({ source }) => {
						const data = loudnessMap.get(source.id);
						const position = data
							? stripLinePositionOf(loudnessStripValuesOf(data)[strip.id], metric.axisMin, range)
							: null;

						if (position === null) return null;

						return (
							<div
								key={source.id}
								className="absolute right-0 left-0 h-0.5"
								style={{ top: `${position * 100}%`, background: source.layerColor.primary }}
							/>
						);
					})}
					<span className="absolute top-0 left-0 bg-chrome-raised font-technical text-xs uppercase tracking-[0.06em] leading-[1.6] text-chrome-text">
						{strip.label}
					</span>
				</div>
			))}
		</div>
	);
}

interface ChartCanvasProps extends ChartCanvasBaseProps {
	readonly metric: MetricSpec;
	readonly onLoudnessData: (sourceId: string, data: LoudnessData | null) => void;
}

function ChartCanvas({ chart, renderableSources, metric, onLoudnessData }: ChartCanvasProps) {
	const { committedStartMs, committedEndMs, startMs: liveStartMs, endMs: liveEndMs } = chart.viewport;
	const dbTicks = visibleValueTicksOf(metric.axisMin, DB_MAX, chart.yRange, DB_TICK_COUNT);

	return (
		<div className="relative h-full w-full overflow-hidden bg-void">
			<HorizontalGridlines fractions={dbTicks.map((db) => dbToY(db, metric.axisMin))} range={chart.yRange} />
			<ChartSvg yRange={chart.yRange}>
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
						onLoudnessData={onLoudnessData}
						onComputeState={chart.progress.handleComputeState}
						onTraceChange={chart.onTraceChange}
					/>
				))}
			</ChartSvg>
		</div>
	);
}

export function LoudnessView({ sources, sourceAudio, settings, onTransportControlChange }: LoudnessViewProps) {
	const { renderableSources, chromeAudio } = useTimelineChromeSources(sources, sourceAudio);

	const metricSpec = useMemo(
		() => METRICS.find((entry) => entry.id === settings.loudnessMetric) ?? DEFAULT_METRIC,
		[settings.loudnessMetric],
	);

	const axis = useMemo<ChartAxis>(
		() => ({
			max: DB_MAX,
			min: metricSpec.axisMin,
			formatValue: (value) => `${value.toFixed(1)} dB`,
			rangeLabel: "Loudness range",
			readoutLabel: metricSpec.label,
			unit: "dB",
			emptyValue: "— dB",
			widestLabel: "-40",
		}),
		[metricSpec.axisMin, metricSpec.label],
	);

	const chart = useChartView(chromeAudio, axis, onTransportControlChange);

	const [loudnessMap, setLoudnessMap] = useState<ReadonlyMap<string, LoudnessData>>(() => new Map());

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

	return (
		<ChartLayout
			chart={chart}
			tickCount={DB_TICK_COUNT}
			renderableSources={renderableSources}
			leading={
				<LoudnessStrips
					renderableSources={renderableSources}
					loudnessMap={loudnessMap}
					metric={metricSpec}
					range={chart.yRange}
				/>
			}
			leadingSpacerClassName="w-[198px]"
		>
			<ChartCanvas
				chart={chart}
				renderableSources={renderableSources}
				metric={metricSpec}
				onLoudnessData={handleLoudnessData}
			/>
		</ChartLayout>
	);
}
