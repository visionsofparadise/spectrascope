import { useMemo } from "react";
import { ChartSvg, HorizontalGridlines, TraceGroup } from "../spectral/chartMarks";
import { ChartLayout, useChartView, type ChartAxis, type ChartCanvasBaseProps } from "../spectral/chartView";
import { useReportComputeState, type ComputeState } from "../spectral/firstComputeProgress";
import { useTraceCompute } from "../spectral/traceCompute";
import { buildPolylineSegments } from "./chartTrace";
import { useChromeSources } from "./viewAudio";
import type { Source } from "../source";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { SpectralOptions } from "spectral-display";

const CORRELATION_CONFIG: SpectralOptions["config"] = {
	spectrogram: false,
	loudness: false,
	truePeak: false,
	stereo: true,
};

interface CorrelationViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const CORR_MAX = 1;
const CORR_MIN = -1;
const CORR_TICKS: ReadonlyArray<number> = [1, 0.5, 0, -0.5, -1];
const CORR_GRID_FRACTIONS: ReadonlyArray<number> = CORR_TICKS.map((corr) => corrToY(corr));

const CORR_AXIS: ChartAxis = {
	max: CORR_MAX,
	min: CORR_MIN,
	formatValue: (value) => `${value.toFixed(2)} r`,
	emptyValue: "— r",
};

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
	const { computeResult, renderable } = useTraceCompute(audioData, startMs, endMs, CORRELATION_CONFIG);

	const envelope = renderable ? renderable.correlationEnvelope : null;

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
			<HorizontalGridlines fractions={CORR_GRID_FRACTIONS} />
			<ChartSvg>
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
					/>
				))}
			</ChartSvg>
		</div>
	);
}

export function CorrelationView({ sources, sourceAudio, onTransportControlChange }: CorrelationViewProps) {
	const { renderableSources, chromeAudio, layerColor } = useChromeSources(sources, sourceAudio);

	const chart = useChartView(chromeAudio, layerColor, CORR_AXIS, onTransportControlChange);

	return (
		<ChartLayout chart={chart} ticks={CORR_TICKS} isEmpty={renderableSources.length === 0}>
			<ChartCanvas chart={chart} renderableSources={renderableSources} />
		</ChartLayout>
	);
}
