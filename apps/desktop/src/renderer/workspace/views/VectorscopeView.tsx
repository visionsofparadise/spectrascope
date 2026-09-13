import { useMemo, useRef, useState } from "react";
import { VectorscopeCanvas } from "spectral-display";
import { rangeTransformOf } from "../spectral/chartMarks";
import { hexToRgb255 } from "../spectral/colorUtil";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { ScrollTrack } from "../spectral/ScrollTrack";
import { scrollTrackTextsOf, trackValueTextOf } from "../spectral/scrollTrackTexts";
import { useTraceCompute } from "../spectral/traceCompute";
import { useContainerSize } from "../spectral/useContainerSize";
import { useDisabledTransport } from "../spectral/viewScaffold";
import { FULL_AXIS_RANGE } from "../utils/axisRange";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { AxisRange } from "../utils/axisRange";
import type { SpectralOptions } from "spectral-display";

const VECTORSCOPE_CONFIG: SpectralOptions["config"] = {
	spectrogram: false,
	loudness: false,
	truePeak: false,
	stereo: true,
};

interface VectorscopeViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const SCOPE_MIN_SPAN = 1 / 4;

interface ScopeRangeProps {
	readonly xRange: AxisRange;
	readonly yRange: AxisRange;
}

function crossLinePositionsOf(xRange: AxisRange, yRange: AxisRange) {
	return {
		x: (0.5 - xRange.start) / (xRange.end - xRange.start),
		y: (0.5 - yRange.start) / (yRange.end - yRange.start),
	};
}

function cloudTransformOf(xRange: AxisRange, yRange: AxisRange): string {
	const xSpan = xRange.end - xRange.start;
	const ySpan = yRange.end - yRange.start;

	return `translate(${(-xRange.start / xSpan) * 100}%, ${(-yRange.start / ySpan) * 100}%) scale(${1 / xSpan}, ${1 / ySpan})`;
}

function FullBleedAxes({ xRange, yRange }: ScopeRangeProps) {
	const positions = crossLinePositionsOf(xRange, yRange);

	return (
		<>
			{positions.x >= 0 && positions.x <= 1 && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 w-px bg-chrome-border"
					style={{ left: `calc(50% - 50cqmin + ${positions.x * 100}cqmin)` }}
				/>
			)}
			{positions.y >= 0 && positions.y <= 1 && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 h-px bg-chrome-border"
					style={{ top: `calc(50% - 50cqmin + ${positions.y * 100}cqmin)` }}
				/>
			)}
		</>
	);
}

function ScopeDiagonals({ xRange, yRange }: ScopeRangeProps) {
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 1 1"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<g transform={rangeTransformOf(xRange, yRange)}>
				<line
					x1={0}
					y1={0}
					x2={1}
					y2={1}
					stroke="var(--color-chrome-text-dim)"
					strokeWidth={1}
					vectorEffect="non-scaling-stroke"
				/>
				<line
					x1={1}
					y1={0}
					x2={0}
					y2={1}
					stroke="var(--color-chrome-text-dim)"
					strokeWidth={1}
					vectorEffect="non-scaling-stroke"
				/>
			</g>
		</svg>
	);
}

interface SourceCloudProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly onComputeState?: (sourceId: string, state: ComputeState | null) => void;
	readonly visibleSpan: number;
}

function SourceCloud({ source, audioData, onComputeState, visibleSpan }: SourceCloudProps) {
	const { computeResult, renderable } = useTraceCompute(
		audioData,
		0,
		audioData.durationMs,
		VECTORSCOPE_CONFIG,
		source.id,
	);

	useReportComputeState(source.id, computeResult, onComputeState);

	const containerRef = useRef<HTMLDivElement>(null);
	const size = useContainerSize(containerRef, { width: 256, height: 256 });
	const baseScale = Math.max(1, Math.min(size.width, size.height)) / 256;
	const canvasScale = Math.max(baseScale, Math.min(4, baseScale / visibleSpan));
	const tint = useMemo(() => hexToRgb255(source.layerColor.primary), [source.layerColor.primary]);

	return (
		<div ref={containerRef} className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
			<VectorscopeCanvas canvasScale={canvasScale} computeResult={renderable ?? computeResult} tint={tint} />
		</div>
	);
}

export function VectorscopeView({ sources, sourceAudio, onTransportControlChange }: VectorscopeViewProps) {
	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	const progress = useFirstComputeProgress();

	useDisabledTransport(onTransportControlChange);

	const [xRange, setXRange] = useState<AxisRange>(FULL_AXIS_RANGE);
	const [yRange, setYRange] = useState<AxisRange>(FULL_AXIS_RANGE);

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-void p-4">
			<div className="flex min-h-0 flex-1 gap-1">
				{renderableSources.length === 0 ? (
					<div className="flex min-w-0 flex-1 items-center justify-center bg-void">
						<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
					</div>
				) : (
					<div
						className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
						style={{ containerType: "size" }}
					>
						<FullBleedAxes xRange={xRange} yRange={yRange} />
						<div
							className="relative aspect-square overflow-hidden"
							style={{ width: "100cqmin", height: "100cqmin" }}
						>
							<div
								className="absolute inset-0"
								style={{
									mixBlendMode: "lighten",
									transform: cloudTransformOf(xRange, yRange),
									transformOrigin: "0 0",
								}}
							>
								{renderableSources.map(({ source, audioData }) => (
									<SourceCloud
										key={source.id}
										source={source}
										audioData={audioData}
										onComputeState={progress.handleComputeState}
										visibleSpan={Math.min(xRange.end - xRange.start, yRange.end - yRange.start)}
									/>
								))}
							</div>
							<ScopeDiagonals xRange={xRange} yRange={yRange} />
						</div>
						{progress.firstComputing && <ComputeProgress fraction={progress.fraction} />}
					</div>
				)}
				<ScrollTrack
					axis="y"
					className="shrink-0"
					range={yRange}
					minSpan={SCOPE_MIN_SPAN}
					onRangeChange={setYRange}
					{...scrollTrackTextsOf("y", "Mid range", yRange, (fraction) => trackValueTextOf(1 - 2 * fraction))}
				/>
			</div>
			<div className="flex shrink-0 pt-1">
				<ScrollTrack
					axis="x"
					className="min-w-0 flex-1"
					range={xRange}
					minSpan={SCOPE_MIN_SPAN}
					onRangeChange={setXRange}
					{...scrollTrackTextsOf("x", "Side range", xRange, (fraction) => trackValueTextOf(2 * fraction - 1))}
				/>
				<div className="w-3 shrink-0" />
			</div>
		</div>
	);
}
