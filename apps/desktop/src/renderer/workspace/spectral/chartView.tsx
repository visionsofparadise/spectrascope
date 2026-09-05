import { useCallback, useMemo, useState } from "react";
import { LinearDbAxis, TimeRuler } from "./Axes";
import { hexToRgb255 } from "./colorUtil";
import { ComputeProgress } from "./ComputeProgress";
import { useFirstComputeProgress } from "./firstComputeProgress";
import { MinimapDisplay } from "./MinimapDisplay";
import { usePublishedTransportControl, useTransportPlayback, useViewportScrub } from "./viewScaffold";
import type { LayerColor } from "../layers";
import type { TransportControl, TransportCursorReadout } from "../Transport";
import type { AudioData } from "./types";
import type { SourceWithAudio } from "../views/viewAudio";

export interface ChartAxis {
	readonly max: number;
	readonly min: number;
	readonly formatValue: (value: number) => string;
	readonly emptyValue: string;
}

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

	const [cursorReadout, setCursorReadout] = useState<TransportCursorReadout>({
		time: "00:00.000",
		amp: axis.emptyValue,
	});

	const { committedStartMs, committedEndMs } = scrub.viewport;

	const handleChartMouseMove = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const rect = event.currentTarget.getBoundingClientRect();

			if (rect.width <= 0 || rect.height <= 0) return;

			const xFrac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
			const yFrac = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

			const totalSec = (committedStartMs + xFrac * (committedEndMs - committedStartMs)) / 1000;
			const mins = Math.floor(totalSec / 60);
			const secs = Math.floor(totalSec % 60);
			const ms = Math.floor((totalSec % 1) * 1000);
			const time = `${mins.toString().padStart(2, "0")}:${secs
				.toString()
				.padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

			setCursorReadout({ time, amp: axis.formatValue(axis.max - yFrac * (axis.max - axis.min)) });
		},
		[committedStartMs, committedEndMs, axis],
	);

	const control = useMemo<TransportControl>(
		() => ({ disabled: false, ...playback, cursorReadout, ...controlExtras }),
		[playback, cursorReadout, controlExtras],
	);

	usePublishedTransportControl(control, onTransportControlChange);

	return { chromeAudio, layerColor, progress, ...scrub, handleChartMouseMove };
}

export interface ChartCanvasBaseProps {
	readonly chart: ChartView;
	readonly renderableSources: ReadonlyArray<SourceWithAudio>;
}

interface ChartLayoutProps {
	readonly chart: ChartView;
	readonly ticks: ReadonlyArray<number>;
	readonly isEmpty: boolean;
	readonly children: React.ReactNode;
}

export function ChartLayout({ chart, ticks, isEmpty, children }: ChartLayoutProps) {
	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-void">
			<div className="flex min-h-0 flex-1 flex-col pr-4">
				<div className="flex shrink-0">
					<div className="w-10 shrink-0 bg-void" />
					<div className="min-w-0 flex-1">
						<TimeRuler startMs={chart.viewport.committedStartMs} endMs={chart.viewport.committedEndMs} />
					</div>
				</div>
				<div className="flex min-h-0 flex-1">
					<LinearDbAxis ticks={ticks} />
					<div
						ref={chart.viewport.wheelHandlers.ref}
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
					</div>
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
				</div>
			</div>
		</div>
	);
}
