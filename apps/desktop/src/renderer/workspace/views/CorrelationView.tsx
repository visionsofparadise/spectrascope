import { scope } from "opshot/react";
import { useMemo, useEffect } from "react";
import { ChartSvg, HorizontalGridlines, TraceGroup } from "../spectral/chartMarks";
import { ChartLayout, useChartView, type ChartAxis, type ChartCanvasBaseProps } from "../spectral/chartView";
import { useReportComputeState } from "../spectral/firstComputeProgress";
import { useTraceCompute } from "../spectral/traceCompute";
import { visibleValueTicksOf } from "../spectral/valueTicks";
import { buildPolylineSegments } from "./chartTrace";
import { useTimelineChromeSources } from "./viewAudio";
import type { SourceViewProps } from "./viewProps";
import type { ChartTraceProps } from "../spectral/chartTraceProps";
import type { ChartReadoutTrace } from "../spectral/useChartReadouts";
import type { SpectralOptions } from "spectral-display";

const CORRELATION_CONFIG: SpectralOptions["config"] = {
	spectrogram: false,
	loudness: false,
	truePeak: false,
	stereo: true,
};

const CORR_MAX = 1;
const CORR_MIN = -1;
const CORR_TICK_COUNT = 5;

const CORR_AXIS: ChartAxis = {
	max: CORR_MAX,
	min: CORR_MIN,
	formatValue: (value) => `${value.toFixed(2)} r`,
	rangeLabel: "Correlation range",
	readoutLabel: "Corr",
	unit: "r",
	emptyValue: "— r",
	widestLabel: "-0.5",
};

function corrToY(corr: number): number {
	const clamped = Math.max(CORR_MIN, Math.min(CORR_MAX, corr));

	return (CORR_MAX - clamped) / (CORR_MAX - CORR_MIN);
}

function SourceCorrelationTrace({
	source,
	audioData,
	startMs,
	endMs,
	liveStartMs,
	liveEndMs,
	onComputeState,
	onTraceChange,
}: ChartTraceProps) {
	const { computeResult, renderable } = useTraceCompute(
		audioData,
		startMs,
		endMs,
		CORRELATION_CONFIG,
		source.id,
		source.timelineOffsetMs,
	);

	const envelope = renderable ? renderable.correlationEnvelope : null;
	const readout = useMemo<ChartReadoutTrace | null>(
		() =>
			renderable && envelope
				? {
						sourceId: source.id,
						query: renderable.query,
						values: envelope,
						valueToY: corrToY,
						formatValue: (value) => value.toFixed(2),
					}
				: null,
		[source.id, renderable, envelope],
	);

	useEffect(() => {
		onTraceChange(source.id, readout);

		return () => onTraceChange(source.id, null);
	}, [source.id, readout, onTraceChange]);

	const segments = useMemo(() => (envelope ? buildPolylineSegments(envelope, corrToY) : []), [envelope]);

	useReportComputeState(source.id, computeResult, onComputeState);

	if (!renderable || segments.length === 0) return null;

	const color = source.layerColor.primary;

	return (
		<TraceGroup
			query={renderable.query}
			liveStartMs={liveStartMs}
			liveEndMs={liveEndMs}
			segments={segments}
			color={color}
		/>
	);
}

function ChartCanvas({ chart, renderableSources }: ChartCanvasBaseProps) {
	const { committedStartMs, committedEndMs, startMs: liveStartMs, endMs: liveEndMs } = chart.viewport;

	return (
		<div className="relative h-full w-full overflow-hidden bg-void">
			<HorizontalGridlines
				fractions={visibleValueTicksOf(CORR_MIN, CORR_MAX, chart.yRange, CORR_TICK_COUNT).map(corrToY)}
				range={chart.yRange}
			/>
			<ChartSvg yRange={chart.yRange}>
				{renderableSources.map(({ source, audioData }) => (
					<SourceCorrelationTrace
						key={source.id}
						source={source}
						audioData={audioData}
						startMs={committedStartMs}
						endMs={committedEndMs}
						liveStartMs={liveStartMs}
						liveEndMs={liveEndMs}
						onComputeState={chart.progress.handleComputeState}
						onTraceChange={chart.onTraceChange}
					/>
				))}
			</ChartSvg>
		</div>
	);
}

export const CorrelationView = scope<SourceViewProps>(
	({ sourceAudio, onTransportControlChange, context }: SourceViewProps) => {
		const { document } = context.session;
		const { renderableSources, chromeAudio } = useTimelineChromeSources(document.sources, sourceAudio);

		const chart = useChartView(chromeAudio, CORR_AXIS, onTransportControlChange, context);

		return (
			<ChartLayout chart={chart} tickCount={CORR_TICK_COUNT} renderableSources={renderableSources} context={context}>
				<ChartCanvas chart={chart} renderableSources={renderableSources} />
			</ChartLayout>
		);
	},
);
