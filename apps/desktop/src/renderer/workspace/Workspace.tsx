import { scope } from "opshot/react";
import { CorrelationView } from "./views/CorrelationView";
import { DifferenceView } from "./views/DifferenceView";
import { FrequencyDistributionView } from "./views/FrequencyDistributionView";
import { LoudnessView } from "./views/LoudnessView";
import { OverlayView } from "./views/OverlayView";
import { SliderView } from "./views/SliderView";
import { SumView } from "./views/SumView";
import { TimelineView } from "./views/TimelineView";
import { VectorscopeView } from "./views/VectorscopeView";
import type { AudioData } from "./spectral/types";
import type { TransportControl } from "./Transport";
import type { SourceManagementProps } from "./views/viewProps";
import type { SessionContext } from "../models/Context";

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

interface WorkspaceProps extends SourceManagementProps {
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly derivedAudio: AudioData;
	readonly onTransportControlChange?: (control: TransportControl) => void;
	readonly context: SessionContext;
}

export const Workspace = scope<WorkspaceProps>(
	({
		sourceAudio,
		derivedAudio,
		onTransportControlChange,
		sourceStatus,
		sourceErrors,
		onRetrySource,
		onRelinkSource,
		context,
	}: WorkspaceProps) => {
		const { navigation } = context.session;
		const activeView = navigation.activeView;

		return (
			<div className="h-full min-h-0 w-full overflow-hidden bg-void">
				{activeView === "timeline" && (
					<TimelineView
						sourceAudio={sourceAudio}
						onTransportControlChange={onTransportControlChange}
						sourceStatus={sourceStatus}
						sourceErrors={sourceErrors}
						onRetrySource={onRetrySource}
						onRelinkSource={onRelinkSource}
						context={context}
					/>
				)}
				{activeView === "overlay" && (
					<OverlayView
						sourceAudio={sourceAudio}
						onTransportControlChange={onTransportControlChange}
						context={context}
					/>
				)}
				{activeView === "slider" && (
					<SliderView
						sourceAudio={sourceAudio}
						onTransportControlChange={onTransportControlChange}
						context={context}
					/>
				)}
				{activeView === "difference" && (
					<DifferenceView
						sourceAudio={sourceAudio}
						derivedAudio={derivedAudio}
						onTransportControlChange={onTransportControlChange}
						context={context}
					/>
				)}
				{activeView === "sum" && (
					<SumView
						sourceAudio={sourceAudio}
						derivedAudio={derivedAudio}
						onTransportControlChange={onTransportControlChange}
						context={context}
					/>
				)}
				{activeView === "frequency-distribution" && (
					<FrequencyDistributionView
						sourceAudio={sourceAudio}
						onTransportControlChange={onTransportControlChange}
						context={context}
					/>
				)}
				{activeView === "loudness" && (
					<LoudnessView
						sourceAudio={sourceAudio}
						onTransportControlChange={onTransportControlChange}
						context={context}
					/>
				)}
				{activeView === "correlation" && (
					<CorrelationView
						sourceAudio={sourceAudio}
						onTransportControlChange={onTransportControlChange}
						context={context}
					/>
				)}
				{activeView === "vectorscope" && (
					<VectorscopeView
						sourceAudio={sourceAudio}
						onTransportControlChange={onTransportControlChange}
						context={context}
					/>
				)}
			</div>
		);
	},
);
