import { CorrelationView } from "./views/CorrelationView";
import { DifferenceView } from "./views/DifferenceView";
import { FrequencyDistributionView } from "./views/FrequencyDistributionView";
import { LoudnessView } from "./views/LoudnessView";
import { OverlayView } from "./views/OverlayView";
import { SliderView } from "./views/SliderView";
import { SumView } from "./views/SumView";
import { TimelineView } from "./views/TimelineView";
import { VectorscopeView } from "./views/VectorscopeView";
import type { Source } from "./source";
import type { AudioData } from "./spectral/types";
import type { SpectralViewControls, DifferenceSelectionProps, SourceManagementProps } from "./views/viewProps";

export type ViewId =
	| "timeline"
	| "overlay"
	| "slider"
	| "difference"
	| "sum"
	| "frequency-distribution"
	| "loudness"
	| "correlation"
	| "vectorscope";

interface WorkspaceProps extends SpectralViewControls, DifferenceSelectionProps, SourceManagementProps {
	/**
	 * Per-source PCM readers, keyed by `Source.id`. Each source carries its own
	 * decoded audio rather than the whole workspace sharing one buffer — the
	 * source/chart views look up each source's `AudioData` here and hand it to
	 * that source's `SourceStrip` / trace. A source absent from the map has no
	 * audio yet (still decoding, or import failed) and is skipped by the views.
	 * An empty map renders an empty workspace.
	 */
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	/**
	 * The active derived (Sum / Difference) signal as a single PCM reader, backed
	 * by the registered `media://` stream for whichever derived view is active.
	 */
	readonly derivedAudio: AudioData;
	readonly sources: ReadonlyArray<Source>;
	readonly activeView: ViewId;
	/**
	 * Emitted when a source is dragged on the Timeline view — `(sourceId,
	 * offsetMs)` with `offsetMs ≥ 0`. Forwarded straight to `TimelineView`; the
	 * other views do not place strips by offset. When omitted, the Timeline
	 * still lays strips out by offset but renders no drag affordance.
	 */
	readonly onSourceOffsetChange?: (sourceId: string, offsetMs: number) => void;
}

export function Workspace({
	sources,
	sourceAudio,
	derivedAudio,
	activeView,
	channelInput,
	settings,
	onFrequencyRangeChange,
	differenceA,
	differenceB,
	onSourceOffsetChange,
	onTransportControlChange,
	sourceStatus,
	sourceErrors,
	onRetrySource,
	onRelinkSource,
	onSourcesChange,
	onAddSources,
	onAddSourceFiles,
}: WorkspaceProps) {
	return (
		<div className="h-full min-h-0 w-full overflow-hidden bg-void">
			{activeView === "timeline" && (
				<TimelineView
					sources={sources}
					sourceAudio={sourceAudio}
					channelInput={channelInput}
					settings={settings}
					onSourceOffsetChange={onSourceOffsetChange}
					onTransportControlChange={onTransportControlChange}
					sourceStatus={sourceStatus}
					sourceErrors={sourceErrors}
					onRetrySource={onRetrySource}
					onRelinkSource={onRelinkSource}
					onSourcesChange={onSourcesChange}
					onAddSources={onAddSources}
					onAddSourceFiles={onAddSourceFiles}
				/>
			)}
			{activeView === "overlay" && (
				<OverlayView
					onFrequencyRangeChange={onFrequencyRangeChange}
					sources={sources}
					sourceAudio={sourceAudio}
					channelInput={channelInput}
					settings={settings}
					onTransportControlChange={onTransportControlChange}
				/>
			)}
			{activeView === "slider" && (
				<SliderView
					differenceA={differenceA}
					differenceB={differenceB}
					onFrequencyRangeChange={onFrequencyRangeChange}
					sources={sources}
					sourceAudio={sourceAudio}
					channelInput={channelInput}
					settings={settings}
					onTransportControlChange={onTransportControlChange}
				/>
			)}
			{activeView === "difference" && (
				<DifferenceView
					onFrequencyRangeChange={onFrequencyRangeChange}
					sources={sources}
					sourceAudio={sourceAudio}
					derivedAudio={derivedAudio}
					channelInput={channelInput}
					settings={settings}
					differenceA={differenceA}
					differenceB={differenceB}
					onTransportControlChange={onTransportControlChange}
				/>
			)}
			{activeView === "sum" && (
				<SumView
					differenceA={differenceA}
					differenceB={differenceB}
					onFrequencyRangeChange={onFrequencyRangeChange}
					sources={sources}
					sourceAudio={sourceAudio}
					derivedAudio={derivedAudio}
					channelInput={channelInput}
					settings={settings}
					onTransportControlChange={onTransportControlChange}
				/>
			)}
			{activeView === "frequency-distribution" && (
				<FrequencyDistributionView
					sources={sources}
					sourceAudio={sourceAudio}
					settings={settings}
					channelInput={channelInput}
					onTransportControlChange={onTransportControlChange}
				/>
			)}
			{activeView === "loudness" && (
				<LoudnessView
					sources={sources}
					sourceAudio={sourceAudio}
					settings={settings}
					onTransportControlChange={onTransportControlChange}
				/>
			)}
			{activeView === "correlation" && (
				<CorrelationView
					sources={sources}
					sourceAudio={sourceAudio}
					onTransportControlChange={onTransportControlChange}
				/>
			)}
			{activeView === "vectorscope" && (
				<VectorscopeView
					sources={sources}
					sourceAudio={sourceAudio}
					onTransportControlChange={onTransportControlChange}
				/>
			)}
		</div>
	);
}
