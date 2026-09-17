import { identify } from "opshot";
import { useCallback, useState } from "react";
import { SourceRender } from "../SourceRender";
import { timeToFraction } from "../views/viewCursor";
import { FrequencyAxis, DbAxis, TimeRuler } from "./Axes";
import { CursorLine, CursorSurface } from "./CursorSurface";
import { FrequencyMinimap } from "./FrequencyMinimap";
import { GridOverlay } from "./GridOverlay";
import { MinimapDisplay, minimapLayersOf } from "./MinimapDisplay";
import { useWaveformReadouts } from "./useWaveformReadouts";
import { ViewProgressProvider, ViewProgressToast } from "./viewProgress";
import { usePublishedTransportControl, useViewportScrub } from "./viewScaffold";
import type { SessionContext } from "../../models/Context";
import type { RenderSettings } from "../../models/State/Session";
import type { Source } from "../source";
import type { TransportControl } from "../Transport";
import type { AudioData } from "./types";
import type { SourceWithAudio } from "../views/viewAudio";
import type { TextureVerticalRange } from "spectral-display";
import type { ChannelInput } from "spectral-display";

type StripView = ReturnType<typeof useStripView>;

export function useStripView(
	chromeAudio: AudioData,
	onTransportControlChange: ((control: TransportControl) => void) | undefined,
	context: SessionContext,
) {
	const { document, navigation } = context.session;
	const readouts = useWaveformReadouts(context);

	const [cursor, setCursor] = useState<number | null>(null);

	const scrub = useViewportScrub(chromeAudio);
	const startMs = scrub.viewport.committedStartMs;
	const endMs = scrub.viewport.committedEndMs;

	usePublishedTransportControl(readouts.control, onTransportControlChange);

	const onFrequencyRangeChange = useCallback(
		(range: TextureVerticalRange) => {
			navigation.frequencyRange = { top: range.top, bottom: range.bottom };
		},
		[identify(navigation)],
	);

	return {
		chromeAudio,
		cursor,
		setCursor,
		...scrub,
		startMs,
		endMs,
		...readouts,
		frequencyRange: navigation.frequencyRange,
		frequencyScale: document.renderSettings.frequencyScale,
		onFrequencyRangeChange,
		cursorFrac: timeToFraction(cursor, scrub.viewport.startMs, scrub.viewport.endMs),
	};
}

interface StripOverlaysProps {
	readonly view: StripView;
	readonly settings: RenderSettings;
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
			<CursorLine fraction={view.cursorFrac} />
		</>
	);
}

interface StripLayoutProps {
	readonly view: StripView;
	readonly children: React.ReactNode;
	readonly channelInput: ChannelInput;
	readonly minimapSources: ReadonlyArray<SourceWithAudio>;
	readonly spectrogram?: boolean;
	readonly context: SessionContext;
}

export function StripLayout({
	view,
	children,
	channelInput,
	minimapSources,
	spectrogram = true,
	context,
}: StripLayoutProps) {
	return (
		<ViewProgressProvider>
			<div className="flex h-full min-h-0 w-full overflow-hidden bg-void">
				<div
					className="min-h-0 min-w-0 flex-1 overflow-hidden"
					style={{
						display: "grid",
						gridTemplateColumns: `${spectrogram ? "auto" : "0"} minmax(0, 1fr) auto auto`,
						gridTemplateRows: "2rem minmax(0, 1fr) 2.5rem",
					}}
				>
					<div className="bg-void" />
					<TimeRuler startMs={view.viewport.startMs} endMs={view.viewport.endMs} context={context} />
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
						cursorMs={view.cursor}
						onCursorChange={view.setCursor}
						context={context}
					>
						{children}
						<ViewProgressToast />
					</CursorSurface>

					<FrequencyMinimap
						amplitude={!spectrogram}
						frequencyRange={view.frequencyRange}
						frequencyScale={view.frequencyScale}
						onFrequencyRangeChange={view.onFrequencyRangeChange}
						sampleRate={view.chromeAudio.sampleRate}
					/>
					<DbAxis verticalRange={view.frequencyRange} />

					<div className="bg-void" />
					<MinimapDisplay
						layers={minimapLayersOf(minimapSources)}
						viewStartFrac={view.viewStartFrac}
						viewEndFrac={view.viewEndFrac}
						channelInput={channelInput}
						onScrubToFraction={view.setViewportToFraction}
					/>
					<div className="bg-void" />
					<div className="bg-void" />
				</div>
			</div>
		</ViewProgressProvider>
	);
}

interface StripSourceRenderProps {
	readonly view: StripView;
	readonly settings: RenderSettings;
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
