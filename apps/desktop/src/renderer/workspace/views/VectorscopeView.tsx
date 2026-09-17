import { scope } from "opshot/react";
import { useCallback, useMemo, useRef } from "react";
import {
	VECTORSCOPE_FULL_SCALE_RADIUS,
	VectorscopeCanvas,
	vectorscopeAmplitudeOf,
	vectorscopeWarpOf,
} from "spectral-display";
import { rangeTransformOf } from "../spectral/chartMarks";
import { hexToRgb255 } from "../spectral/colorUtil";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { EMPTY_READOUT } from "../spectral/readoutRows";
import { ScrollTrack } from "../spectral/ScrollTrack";
import { scrollTrackTextsOf, trackValueTextOf } from "../spectral/scrollTrackTexts";
import { useTraceCompute } from "../spectral/traceCompute";
import { useContainerSize } from "../spectral/useContainerSize";
import { ViewProgressProvider, ViewProgressToast } from "../spectral/viewProgress";
import { usePointerReadoutTransport } from "../spectral/viewScaffold";
import { axisFractionOf } from "../utils/axisRange";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { SourceViewProps } from "./viewProps";
import type { Source } from "../source";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportReadoutRow } from "../Transport";
import type { AxisRange } from "../utils/axisRange";
import type { SpectralOptions, VectorscopeScale } from "spectral-display";

const VECTORSCOPE_CONFIG: SpectralOptions["config"] = {
	spectrogram: false,
	loudness: false,
	truePeak: false,
	stereo: true,
};

const SCOPE_MIN_SPAN = 1 / 4;

interface ScopeRangeProps {
	readonly xRange: AxisRange;
	readonly yRange: AxisRange;
}

function visibleFractionOf(range: AxisRange): number | undefined {
	const fraction = axisFractionOf(0.5, range);

	return fraction >= 0 && fraction <= 1 ? fraction : undefined;
}

export function crossLinePositionsOf(
	xRange: AxisRange,
	yRange: AxisRange,
): { readonly x: number | undefined; readonly y: number | undefined } {
	return { x: visibleFractionOf(xRange), y: visibleFractionOf(yRange) };
}

function levelReadoutOf(amplitude: number): string {
	return amplitude === 0 ? "−∞ dB" : `${(20 * Math.log10(Math.abs(amplitude))).toFixed(1)} dB`;
}

export function stereoReadoutRowsOf(x: number, mid: number): ReadonlyArray<TransportReadoutRow> {
	const magnitude = Math.abs(mid) + Math.abs(x);

	return [
		{ label: "L", cursor: levelReadoutOf(mid - x), in: EMPTY_READOUT, out: EMPTY_READOUT },
		{ label: "R", cursor: levelReadoutOf(mid + x), in: EMPTY_READOUT, out: EMPTY_READOUT },
		{
			label: "Width",
			cursor: magnitude === 0 ? EMPTY_READOUT : (Math.abs(x) / magnitude).toFixed(2),
			in: EMPTY_READOUT,
			out: EMPTY_READOUT,
		},
	];
}

const EMPTY_STEREO_ROWS = ["L", "R", "Width"].map((label) => ({
	label,
	cursor: EMPTY_READOUT,
	in: EMPTY_READOUT,
	out: EMPTY_READOUT,
}));

export function scopeSignalOf(
	pointer: { readonly x: number; readonly y: number },
	scale: VectorscopeScale,
): { readonly x: number; readonly mid: number } {
	const x = 2 * pointer.x - 1;
	const y = 1 - 2 * pointer.y;
	const distance = Math.hypot(x, y);

	if (distance === 0) return { x: 0, mid: 0 };

	const factor = vectorscopeAmplitudeOf(distance / VECTORSCOPE_FULL_SCALE_RADIUS, scale) / distance;

	return { x: x * factor, mid: y * factor };
}

export function scopeAxisValueOf(axis: "x" | "y", fraction: number, scale: VectorscopeScale): number {
	return axis === "x"
		? scopeSignalOf({ x: fraction, y: 0.5 }, scale).x
		: scopeSignalOf({ x: 0.5, y: fraction }, scale).mid;
}

export function ringRadiiOf(scale: VectorscopeScale): ReadonlyArray<number> {
	return [-6, -12, -18].map((db) => (VECTORSCOPE_FULL_SCALE_RADIUS / 2) * vectorscopeWarpOf(10 ** (db / 20), scale));
}

export function canvasScaleOf(baseScale: number, visibleSpan: number): number {
	return Math.max(baseScale, Math.min(4, baseScale * 2 ** Math.ceil(Math.log2(1 / visibleSpan))));
}

export function cloudTransformOf(xRange: AxisRange, yRange: AxisRange): string {
	const xSpan = xRange.end - xRange.start;
	const ySpan = yRange.end - yRange.start;

	return `translate(${(-xRange.start / xSpan) * 100}%, ${(-yRange.start / ySpan) * 100}%) scale(${1 / xSpan}, ${1 / ySpan})`;
}

function FullBleedAxes({ xRange, yRange }: ScopeRangeProps) {
	const positions = crossLinePositionsOf(xRange, yRange);

	return (
		<>
			{positions.x !== undefined && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 w-px bg-chrome-border"
					style={{ left: `calc(50% - 50cqmin + ${positions.x * 100}cqmin)` }}
				/>
			)}
			{positions.y !== undefined && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 h-px bg-chrome-border"
					style={{ top: `calc(50% - 50cqmin + ${positions.y * 100}cqmin)` }}
				/>
			)}
		</>
	);
}

const SCOPE_LABEL_CLASS = "pointer-events-none absolute font-technical text-xs tracking-[0.06em] text-chrome-text-dim";

function ScopeLabels() {
	return (
		<>
			<span className={`${SCOPE_LABEL_CLASS} top-0 left-1/2 -translate-x-1/2`}>+M</span>
			<span className={`${SCOPE_LABEL_CLASS} bottom-0 left-1/2 -translate-x-1/2`}>−M</span>
			<span className={`${SCOPE_LABEL_CLASS} top-1/2 left-0 -translate-y-1/2`}>−S</span>
			<span className={`${SCOPE_LABEL_CLASS} top-1/2 right-0 -translate-y-1/2`}>+S</span>
			<span className={`${SCOPE_LABEL_CLASS} top-[8%] left-[8%]`}>L</span>
			<span className={`${SCOPE_LABEL_CLASS} top-[8%] right-[8%]`}>R</span>
		</>
	);
}

interface ScopeGuidesProps extends ScopeRangeProps {
	readonly scale: VectorscopeScale;
}

function ScopeGuides({ xRange, yRange, scale }: ScopeGuidesProps) {
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 1 1"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<g transform={rangeTransformOf(xRange, yRange)}>
				<circle
					cx={0.5}
					cy={0.5}
					r={VECTORSCOPE_FULL_SCALE_RADIUS / 2}
					fill="none"
					stroke="var(--color-chrome-border)"
					strokeWidth={1}
					vectorEffect="non-scaling-stroke"
				/>
				{ringRadiiOf(scale).map((radius, index) => (
					<circle
						key={index}
						cx={0.5}
						cy={0.5}
						r={radius}
						fill="none"
						stroke="var(--color-chrome-border-subtle)"
						strokeWidth={1}
						vectorEffect="non-scaling-stroke"
					/>
				))}
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
	readonly scale: VectorscopeScale;
}

function SourceCloud({ source, audioData, onComputeState, visibleSpan, scale }: SourceCloudProps) {
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
	const canvasScale = canvasScaleOf(baseScale, visibleSpan);
	const tint = useMemo(() => hexToRgb255(source.layerColor.primary), [source.layerColor.primary]);

	return (
		<div ref={containerRef} className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
			<VectorscopeCanvas
				canvasScale={canvasScale}
				computeResult={renderable ?? computeResult}
				tint={tint}
				scale={scale}
			/>
		</div>
	);
}

export const VectorscopeView = scope<SourceViewProps>(
	({ sourceAudio, onTransportControlChange, context }: SourceViewProps) => {
		const { document } = context.session;
		const sources = document.sources;
		const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);
		const scale = document.renderSettings.vectorscopeScale;

		const stereoPointerReadoutRowsOf = useCallback(
			(pointer: { readonly x: number; readonly y: number } | null): ReadonlyArray<TransportReadoutRow> => {
				if (!pointer) return EMPTY_STEREO_ROWS;

				const signal = scopeSignalOf(pointer, scale);

				return stereoReadoutRowsOf(signal.x, signal.mid);
			},
			[scale],
		);

		const { xRange, setXRange, yRange, setYRange, onMouseMove, onMouseLeave } = usePointerReadoutTransport(
			stereoPointerReadoutRowsOf,
			onTransportControlChange,
		);

		const progress = useFirstComputeProgress();

		return (
			<ViewProgressProvider>
				<div className="flex h-full min-h-0 w-full flex-col bg-void pt-4">
					<div className="flex min-h-0 flex-1">
						{renderableSources.length === 0 ? (
							<div className="flex min-w-0 flex-1 items-center justify-center bg-void">
								<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
							</div>
						) : (
							<div className="flex min-h-0 min-w-0 flex-1">
								<div
									className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
									style={{ containerType: "size" }}
								>
									<FullBleedAxes xRange={xRange} yRange={yRange} />
									<div
										className="relative aspect-square overflow-hidden"
										style={{ width: "100cqmin", height: "100cqmin" }}
										onMouseMove={onMouseMove}
										onMouseLeave={onMouseLeave}
									>
										<ScopeLabels />
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
													scale={scale}
												/>
											))}
										</div>
										<ScopeGuides xRange={xRange} yRange={yRange} scale={scale} />
									</div>
									{progress.firstComputing && <ComputeProgress fraction={progress.fraction} />}
									<ViewProgressToast />
								</div>
							</div>
						)}
						<ScrollTrack
							axis="y"
							className="shrink-0"
							range={yRange}
							minSpan={SCOPE_MIN_SPAN}
							onRangeChange={setYRange}
							{...scrollTrackTextsOf("y", "Mid range", yRange, (fraction) =>
								trackValueTextOf(scopeAxisValueOf("y", fraction, scale)),
							)}
						/>
					</div>
					<div className="flex shrink-0">
						<ScrollTrack
							axis="x"
							className="min-w-0 flex-1"
							range={xRange}
							minSpan={SCOPE_MIN_SPAN}
							onRangeChange={setXRange}
							{...scrollTrackTextsOf("x", "Side range", xRange, (fraction) =>
								trackValueTextOf(scopeAxisValueOf("x", fraction, scale)),
							)}
						/>
						<div className="w-3 shrink-0" />
					</div>
				</div>
			</ViewProgressProvider>
		);
	},
);
