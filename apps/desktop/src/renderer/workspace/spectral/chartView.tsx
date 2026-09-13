import { useCallback, useMemo, useState } from "react";
import { FULL_AXIS_RANGE } from "../utils/axisRange";
import { LinearDbAxis, TimeRuler } from "./Axes";
import { hexToRgb255 } from "./colorUtil";
import { ComputeProgress } from "./ComputeProgress";
import { useFirstComputeProgress } from "./firstComputeProgress";
import { MinimapDisplay } from "./MinimapDisplay";
import { ScrollTrack } from "./ScrollTrack";
import { scrollTrackTextsOf, trackValueTextOf } from "./scrollTrackTexts";
import { SelectionSurface } from "./SelectionSurface";
import { useChartReadouts } from "./useChartReadouts";
import { ViewProgressProvider, ViewProgressToast } from "./viewProgress";
import { usePublishedTransportControl, useTransportPlayback, useViewportScrub } from "./viewScaffold";
import type { LayerColor } from "../layers";
import type { TransportControl } from "../Transport";
import type { AudioData } from "./types";
import type { AxisRange } from "../utils/axisRange";
import type { SourceWithAudio } from "../views/viewAudio";

export interface ChartAxis {
	readonly max: number;
	readonly min: number;
	readonly formatValue: (value: number) => string;
	readonly emptyValue: string;
	readonly rangeLabel: string;
	readonly readoutLabel: string;
	readonly unit: string;
}

const CHART_MIN_VALUE_SPAN = 1 / 32;

type ChartView = ReturnType<typeof useChartView>;

export function useChartView(
	chromeAudio: AudioData,
	layerColor: LayerColor,
	axis: ChartAxis,
	onTransportControlChange?: (control: TransportControl) => void,
	controlExtras?: Partial<TransportControl>,
) {
	const scrub = useViewportScrub(chromeAudio);

	const progress = useFirstComputeProgress();

	const playback = useTransportPlayback(chromeAudio.durationMs / 1000);

	const readouts = useChartReadouts(axis.readoutLabel);

	const [yRange, setYRange] = useState<AxisRange>(FULL_AXIS_RANGE);

	const { startMs, endMs } = scrub.viewport;

	const handleChartMouseMove = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const rect = event.currentTarget.getBoundingClientRect();

			if (rect.width <= 0 || rect.height <= 0) return;

			const xFrac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
			const yFrac = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

			readouts.setCursor({
				timeMs: startMs + xFrac * (endMs - startMs),
				y: yRange.start + yFrac * (yRange.end - yRange.start),
			});
		},
		[startMs, endMs, yRange, readouts.setCursor],
	);

	const control = useMemo<TransportControl>(
		() => ({ disabled: false, ...playback, ...readouts.control, ...controlExtras }),
		[playback, readouts.control, controlExtras],
	);

	usePublishedTransportControl(control, onTransportControlChange);

	return {
		chromeAudio,
		layerColor,
		axis,
		yRange,
		setYRange,
		progress,
		...scrub,
		handleChartMouseMove,
		onTraceChange: readouts.onTraceChange,
	};
}

export interface ChartCanvasBaseProps {
	readonly chart: ChartView;
	readonly renderableSources: ReadonlyArray<SourceWithAudio>;
}

interface ChartLayoutProps {
	readonly chart: ChartView;
	readonly tickCount: number;
	readonly isEmpty: boolean;
	readonly children: React.ReactNode;
}

export function ChartLayout({ chart, tickCount, isEmpty, children }: ChartLayoutProps) {
	const { max, min, rangeLabel, unit } = chart.axis;

	return (
		<ViewProgressProvider>
			<div className="flex h-full min-h-0 w-full flex-col bg-void">
				<div className="flex min-h-0 flex-1 flex-col pr-4">
					<div className="flex shrink-0">
						<div className="w-10 shrink-0 bg-void" />
						<div className="min-w-0 flex-1">
							<TimeRuler startMs={chart.viewport.startMs} endMs={chart.viewport.endMs} />
						</div>
						<div className="w-2 shrink-0" />
					</div>
					<div className="flex min-h-0 flex-1">
						<LinearDbAxis min={min} max={max} tickCount={tickCount} range={chart.yRange} />
						<SelectionSurface
							ref={chart.viewport.wheelHandlers.ref}
							startMs={chart.viewport.startMs}
							endMs={chart.viewport.endMs}
							seekOnClick
							className="relative min-w-0 flex-1"
							onMouseMove={chart.handleChartMouseMove}
						>
							{isEmpty ? (
								<div className="flex h-full items-center justify-center bg-void">
									<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
								</div>
							) : (
								<>
									{children}
									{chart.progress.firstComputing && <ComputeProgress fraction={chart.progress.fraction} />}
								</>
							)}
							<ViewProgressToast />
						</SelectionSurface>
						<ScrollTrack
							axis="y"
							className="shrink-0"
							range={chart.yRange}
							minSpan={CHART_MIN_VALUE_SPAN}
							onRangeChange={chart.setYRange}
							{...scrollTrackTextsOf(
								"y",
								rangeLabel,
								chart.yRange,
								(fraction) => trackValueTextOf(max - fraction * (max - min)),
								unit,
							)}
						/>
					</div>
					<div className="flex shrink-0">
						<div className="w-10 shrink-0 bg-void" />
						<div className="min-w-0 flex-1">
							<MinimapDisplay
								audioData={chart.chromeAudio}
								viewStartFrac={chart.viewStartFrac}
								viewEndFrac={chart.viewEndFrac}
								waveformColor={hexToRgb255(chart.layerColor.primary)}
								onScrubToFraction={chart.setViewportToFraction}
							/>
						</div>
						<div className="w-2 shrink-0" />
					</div>
				</div>
			</div>
		</ViewProgressProvider>
	);
}
