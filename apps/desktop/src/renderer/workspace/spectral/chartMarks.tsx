import { computeWindowTransform } from "../useTimeViewport";
import { axisFractionOf, FULL_AXIS_RANGE } from "../utils/axisRange";
import type { AxisRange } from "../utils/axisRange";
import type { SpectralQuery } from "spectral-display";

export function TracePolylines({
	segments,
	color,
}: {
	readonly segments: ReadonlyArray<string>;
	readonly color: string;
}) {
	return (
		<>
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
		</>
	);
}

interface GridlinesProps {
	readonly fractions: ReadonlyArray<number>;
	readonly range?: AxisRange;
}

function visiblePositionsOf(fractions: ReadonlyArray<number>, range: AxisRange) {
	return fractions
		.map((fraction) => ({ fraction, position: axisFractionOf(fraction, range) }))
		.filter(({ position }) => position >= 0 && position <= 1);
}

export function HorizontalGridlines({ fractions, range = FULL_AXIS_RANGE }: GridlinesProps) {
	return (
		<>
			{visiblePositionsOf(fractions, range).map(({ fraction, position }) => (
				<div
					key={`h${fraction}`}
					className="pointer-events-none absolute left-0 right-0 h-px bg-chrome-border-subtle"
					style={{ top: `${position * 100}%` }}
				/>
			))}
		</>
	);
}

export function VerticalGridlines({ fractions, range = FULL_AXIS_RANGE }: GridlinesProps) {
	return (
		<>
			{visiblePositionsOf(fractions, range).map(({ fraction, position }) => (
				<div
					key={`v${fraction}`}
					className="pointer-events-none absolute top-0 bottom-0 w-px bg-chrome-border-subtle"
					style={{ left: `${position * 100}%` }}
				/>
			))}
		</>
	);
}

export function rangeTransformOf(xRange: AxisRange, yRange: AxisRange): string {
	const xSpan = xRange.end - xRange.start;
	const ySpan = yRange.end - yRange.start;

	return `translate(${-xRange.start / xSpan} ${-yRange.start / ySpan}) scale(${1 / xSpan} ${1 / ySpan})`;
}

export function ChartSvg({
	children,
	xRange = FULL_AXIS_RANGE,
	yRange = FULL_AXIS_RANGE,
}: {
	readonly children: React.ReactNode;
	readonly xRange?: AxisRange;
	readonly yRange?: AxisRange;
}) {
	return (
		<svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
			<g transform={rangeTransformOf(xRange, yRange)}>{children}</g>
		</svg>
	);
}

export function TraceGroup({
	query,
	liveStartMs,
	liveEndMs,
	segments,
	color,
}: {
	readonly query: SpectralQuery;
	readonly liveStartMs: number;
	readonly liveEndMs: number;
	readonly segments: ReadonlyArray<string>;
	readonly color: string;
}) {
	return (
		<g
			style={{
				transform: computeWindowTransform(query, { startMs: liveStartMs, endMs: liveEndMs }),
				transformOrigin: "left",
			}}
		>
			<TracePolylines segments={segments} color={color} />
		</g>
	);
}
