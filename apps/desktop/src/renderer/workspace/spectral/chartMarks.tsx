import { computeWindowTransform } from "../useTimeViewport";
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

export function HorizontalGridlines({ fractions }: { readonly fractions: ReadonlyArray<number> }) {
	return (
		<>
			{fractions.map((fraction) => (
				<div
					key={`h${fraction}`}
					className="pointer-events-none absolute left-0 right-0 h-px bg-chrome-border-subtle"
					style={{ top: `${fraction * 100}%` }}
				/>
			))}
		</>
	);
}

export function VerticalGridlines({ fractions }: { readonly fractions: ReadonlyArray<number> }) {
	return (
		<>
			{fractions.map((fraction) => (
				<div
					key={`v${fraction}`}
					className="pointer-events-none absolute top-0 bottom-0 w-px bg-chrome-border-subtle"
					style={{ left: `${fraction * 100}%` }}
				/>
			))}
		</>
	);
}

export function ChartSvg({ children }: { readonly children: React.ReactNode }) {
	return (
		<svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
			{children}
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
