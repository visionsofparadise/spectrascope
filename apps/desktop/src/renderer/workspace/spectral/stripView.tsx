import { useMemo, useState } from "react";
import { SourceRender } from "../SourceRender";
import { useViewSync } from "../sync";
import { timeToFraction } from "../views/viewCursor";
import { FrequencyAxis, DbAxis, TimeRuler } from "./Axes";
import { hexToRgb255 } from "./colorUtil";
import { CursorSurface } from "./CursorSurface";
import { FrequencyMinimap } from "./FrequencyMinimap";
import { GridOverlay } from "./GridOverlay";
import { MinimapDisplay } from "./MinimapDisplay";
import { Selection } from "./Selection";
import { usePublishedTransportControl, useTransportPlayback, useViewportScrub } from "./viewScaffold";
import type { LayerColor } from "../layers";
import type { Source } from "../source";
import type { SourceRenderCursorReadout } from "../SourceRender";
import type { TransportControl } from "../Transport";
import type { ViewControlSettings } from "../viewSettings";
import type { AudioData } from "./types";
import type { ChannelInput } from "spectral-display";

const EMPTY_VIEW_SYNC = {
	cursor: null,
	selection: null,
} as const;

const DEFAULT_CURSOR: SourceRenderCursorReadout = {
	time: "00:00.000",
	freq: "— Hz",
	amp: "— dB",
};

type StripView = ReturnType<typeof useStripView>;

export function useStripView(
	viewId: string,
	chromeAudio: AudioData,
	layerColor: LayerColor,
	onTransportControlChange?: (control: TransportControl) => void,
) {
	const [cursorReadout, setCursorReadout] = useState<SourceRenderCursorReadout>(DEFAULT_CURSOR);

	const viewSync = useViewSync(viewId, EMPTY_VIEW_SYNC);

	const scrub = useViewportScrub(chromeAudio);
	const startMs = scrub.viewport.committedStartMs;
	const endMs = scrub.viewport.committedEndMs;

	const playback = useTransportPlayback(chromeAudio.durationMs / 1000);

	const control = useMemo<TransportControl>(
		() => ({
			...playback,
			cursorReadout,
			selectionInSec: viewSync.selection !== null ? viewSync.selection.start / 1000 : undefined,
			selectionOutSec: viewSync.selection !== null ? viewSync.selection.end / 1000 : undefined,
		}),
		[playback, cursorReadout, viewSync.selection],
	);

	usePublishedTransportControl(control, onTransportControlChange);

	return {
		chromeAudio,
		layerColor,
		viewSync,
		...scrub,
		startMs,
		endMs,
		setCursorReadout,
		cursorFrac: timeToFraction(viewSync.cursor, startMs, endMs),
		selectionStartFrac: timeToFraction(viewSync.selection?.start ?? null, startMs, endMs),
		selectionEndFrac: timeToFraction(viewSync.selection?.end ?? null, startMs, endMs),
	};
}

interface StripOverlaysProps {
	readonly view: StripView;
	readonly settings: ViewControlSettings;
}

export function StripOverlays({ view, settings }: StripOverlaysProps) {
	return (
		<>
			<GridOverlay
				startMs={view.startMs}
				endMs={view.endMs}
				mode={settings.gridMode}
				opacity={settings.gridOpacity}
			/>
			{view.selectionStartFrac !== null && view.selectionEndFrac !== null && (
				<Selection startFraction={view.selectionStartFrac} endFraction={view.selectionEndFrac} />
			)}
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
}

export function StripLayout({ view, header, children }: StripLayoutProps) {
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
					gridTemplateColumns: "2.5rem minmax(0, 1fr) auto auto",
					gridTemplateRows: "2rem minmax(0, 1fr) 2rem",
				}}
			>
				<div className="bg-void" />
				<TimeRuler startMs={view.startMs} endMs={view.endMs} />
				<div className="bg-void" />
				<div className="bg-void" />

				<FrequencyAxis />

				<CursorSurface
					surfaceRef={view.viewport.wheelHandlers.ref}
					className="relative cursor-crosshair overflow-hidden bg-void"
					startMs={view.startMs}
					endMs={view.endMs}
					cursorMs={view.viewSync.cursor}
					onCursorChange={view.viewSync.setCursor}
				>
					{children}
				</CursorSurface>

				<FrequencyMinimap
					audioData={view.chromeAudio}
					startMs={view.startMs}
					endMs={view.endMs}
					layerColor={view.layerColor}
				/>
				<DbAxis />

				<div className="bg-void" />
				<MinimapDisplay
					audioData={view.chromeAudio}
					viewStartFrac={view.viewStartFrac}
					viewEndFrac={view.viewEndFrac}
					waveformColor={hexToRgb255(view.layerColor.primary)}
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
}

export function StripSourceRender({
	view,
	settings,
	channelInput,
	source,
	audioData,
	opacity,
	clipPath,
}: StripSourceRenderProps) {
	return (
		<SourceRender
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
