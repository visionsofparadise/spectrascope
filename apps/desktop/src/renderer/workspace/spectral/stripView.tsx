import { useMemo } from "react";
import { SourceRender } from "../SourceRender";
import { useViewSync } from "../sync";
import { timeToFraction } from "../views/viewCursor";
import { FrequencyAxis, DbAxis, TimeRuler } from "./Axes";
import { hexToRgb255 } from "./colorUtil";
import { CursorSurface } from "./CursorSurface";
import { FrequencyMinimap } from "./FrequencyMinimap";
import { GridOverlay } from "./GridOverlay";
import { MinimapDisplay } from "./MinimapDisplay";
import { useWaveformReadouts } from "./useWaveformReadouts";
import { usePublishedTransportControl, useTransportPlayback, useViewportScrub } from "./viewScaffold";
import type { LayerColor } from "../layers";
import type { Source } from "../source";
import type { TransportControl } from "../Transport";
import type { ViewControlSettings } from "../viewSettings";
import type { AudioData } from "./types";
import type { FrequencyScale } from "spectral-display";
import type { TextureVerticalRange } from "spectral-display";
import type { ChannelInput } from "spectral-display";

const EMPTY_VIEW_SYNC = {
	cursor: null,
	selection: null,
} as const;

type StripView = ReturnType<typeof useStripView>;

export function useStripView(
	viewId: string,
	chromeAudio: AudioData,
	layerColor: LayerColor,
	frequencyRange: TextureVerticalRange,
	frequencyScale: FrequencyScale,
	onFrequencyRangeChange: (range: TextureVerticalRange) => void,
	onTransportControlChange?: (control: TransportControl) => void,
) {
	const readouts = useWaveformReadouts();

	const viewSync = useViewSync(viewId, EMPTY_VIEW_SYNC);

	const scrub = useViewportScrub(chromeAudio);
	const startMs = scrub.viewport.committedStartMs;
	const endMs = scrub.viewport.committedEndMs;

	const playback = useTransportPlayback(chromeAudio.durationMs / 1000);

	const control = useMemo<TransportControl>(
		() => ({
			...playback,
			...readouts.control,
			selectionInSec: viewSync.selection !== null ? viewSync.selection.start / 1000 : undefined,
			selectionOutSec: viewSync.selection !== null ? viewSync.selection.end / 1000 : undefined,
		}),
		[playback, readouts.control, viewSync.selection],
	);

	usePublishedTransportControl(control, onTransportControlChange);

	return {
		chromeAudio,
		layerColor,
		viewSync,
		...scrub,
		startMs,
		endMs,
		...readouts,
		frequencyRange,
		frequencyScale,
		onFrequencyRangeChange,
		cursorFrac: timeToFraction(viewSync.cursor, scrub.viewport.startMs, scrub.viewport.endMs),
	};
}

interface StripOverlaysProps {
	readonly view: StripView;
	readonly settings: ViewControlSettings;
	readonly spectrogram?: boolean;
}

export function StripOverlays({ view, settings, spectrogram = true }: StripOverlaysProps) {
	return (
		<>
			<GridOverlay
				startMs={view.viewport.startMs}
				endMs={view.viewport.endMs}
				mode={spectrogram ? settings.gridMode : "amp"}
				sampleRate={view.chromeAudio.sampleRate}
				frequencyRange={view.frequencyRange}
				frequencyScale={view.frequencyScale}
				opacity={settings.gridOpacity}
			/>
			{view.cursorFrac !== null && view.cursorFrac >= 0 && view.cursorFrac <= 1 && (
				<div
					className="pointer-events-none absolute top-0 bottom-0 w-px bg-data-cursor"
					style={{ left: `${view.cursorFrac * 100}%` }}
				/>
			)}
		</>
	);
}

interface StripLayoutProps {
	readonly view: StripView;
	readonly header?: React.ReactNode;
	readonly children: React.ReactNode;
	readonly channelInput: ChannelInput;
	readonly spectrogram?: boolean;
}

export function StripLayout({ view, header, children, channelInput, spectrogram = true }: StripLayoutProps) {
	return (
		<div
			className={
				header
					? "flex h-full min-h-0 w-full flex-col overflow-hidden bg-void"
					: "flex h-full min-h-0 w-full overflow-hidden bg-void"
			}
		>
			{header}
			<div
				className="min-h-0 min-w-0 flex-1 overflow-hidden"
				style={{
					display: "grid",
					gridTemplateColumns: `${spectrogram ? "2.5rem" : "0px"} minmax(0, 1fr) auto auto`,
					gridTemplateRows: "2rem minmax(0, 1fr) 2rem",
				}}
			>
				<div className="bg-void" />
				<TimeRuler startMs={view.viewport.startMs} endMs={view.viewport.endMs} />
				<div className="bg-void" />
				<div className="bg-void" />

				{spectrogram ? (
					<FrequencyAxis
						sampleRate={view.chromeAudio.sampleRate}
						frequencyRange={view.frequencyRange}
						frequencyScale={view.frequencyScale}
					/>
				) : (
					<div className="bg-void" />
				)}

				<CursorSurface
					surfaceRef={view.viewport.wheelHandlers.ref}
					className="relative cursor-crosshair overflow-hidden bg-void"
					startMs={view.viewport.startMs}
					endMs={view.viewport.endMs}
					cursorMs={view.viewSync.cursor}
					onCursorChange={view.viewSync.setCursor}
				>
					{children}
				</CursorSurface>

				<FrequencyMinimap
					amplitude={!spectrogram}
					frequencyRange={view.frequencyRange}
					frequencyScale={view.frequencyScale}
					onFrequencyRangeChange={view.onFrequencyRangeChange}
					sampleRate={view.chromeAudio.sampleRate}
					computeResult={null}
					startMs={view.viewport.startMs}
					endMs={view.viewport.endMs}
					tiles={
						spectrogram
							? [...view.displayed.values()].flatMap((entry) =>
									(entry.spectrogramResults ?? (entry.result ? [entry.result] : []))
										.filter(
											(result) =>
												result.options.readSamples ===
												(view.chromeAudio.timelinePlacement?.source ?? view.chromeAudio).readSamples,
										)
										.map((result) => ({ result, timeOffsetMs: entry.timeOffsetMs })),
								)
							: []
					}
				/>
				<DbAxis verticalRange={view.frequencyRange} />

				<div className="bg-void" />
				<MinimapDisplay
					audioData={view.chromeAudio}
					viewStartFrac={view.viewStartFrac}
					viewEndFrac={view.viewEndFrac}
					waveformColor={hexToRgb255(view.layerColor.primary)}
					channelInput={channelInput}
					onScrubToFraction={view.setViewportToFraction}
				/>
				<div className="bg-void" />
				<div className="bg-void" />
			</div>
		</div>
	);
}

interface StripSourceRenderProps {
	readonly view: StripView;
	readonly settings: ViewControlSettings;
	readonly channelInput: ChannelInput;
	readonly source: Source;
	readonly audioData: AudioData;
	readonly opacity?: number;
	readonly clipPath?: string;
	readonly spectrogram?: boolean;
}

export function StripSourceRender({
	view,
	settings,
	channelInput,
	source,
	audioData,
	opacity,
	clipPath,
	spectrogram = true,
}: StripSourceRenderProps) {
	return (
		<SourceRender
			displaySampleRate={view.chromeAudio.sampleRate}
			spectrogram={spectrogram}
			spectrogramColormap={settings.spectrogramColormap}
			frequencyRange={view.frequencyRange}
			frequencyScale={view.frequencyScale}
			spectrogramSampling={settings.spectrogramSampling}
			onDisplayedResultChange={view.onDisplayedResultChange}
			source={source}
			audioData={audioData}
			startMs={view.startMs}
			endMs={view.endMs}
			liveStartMs={view.viewport.startMs}
			liveEndMs={view.viewport.endMs}
			fftSize={settings.fftSize}
			hopOverlap={settings.hopOverlap}
			channelInput={channelInput}
			opacity={opacity}
			clipPath={clipPath}
			waveformOpacity={settings.waveformOpacity}
			spectrogramOpacity={settings.spectrogramOpacity}
			onCursorMove={view.setCursorReadout}
		/>
	);
}
