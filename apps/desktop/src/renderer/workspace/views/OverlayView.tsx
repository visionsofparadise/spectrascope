import { scope } from "opshot/react";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import { useTimelineChromeSources } from "./viewAudio";
import type { SourceViewProps } from "./viewProps";

export const OverlayView = scope<SourceViewProps>(
	({ sourceAudio, onTransportControlChange, context }: SourceViewProps) => {
		const { document } = context.session;
		const { sources, channelInput, renderSettings } = document;
		const { renderableSources, chromeAudio } = useTimelineChromeSources(sources, sourceAudio);

		const view = useStripView(chromeAudio, onTransportControlChange, context);

		return (
			<StripLayout
				channelInput={channelInput}
				view={view}
				minimapSources={renderableSources}
				spectrogram={false}
				context={context}
			>
				{renderableSources.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
					</div>
				) : (
					<>
						<div className="absolute inset-0" style={{ mixBlendMode: "lighten" }}>
							{renderableSources.map(({ source, audioData }) => (
								<StripSourceRender
									key={source.id}
									view={view}
									settings={renderSettings}
									channelInput={channelInput}
									source={source}
									audioData={audioData}
									opacity={0.5}
									spectrogram={false}
								/>
							))}
						</div>
						<StripOverlays view={view} settings={renderSettings} spectrogram={false} />
					</>
				)}
			</StripLayout>
		);
	},
);
