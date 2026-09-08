import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import { useTimelineChromeSources } from "./viewAudio";
import type { PerSourceSpectralViewProps } from "./viewProps";

export function OverlayView({
	sources,
	sourceAudio,
	channelInput,
	settings,
	onFrequencyRangeChange,
	onTransportControlChange,
}: PerSourceSpectralViewProps) {
	const { renderableSources, chromeAudio, layerColor } = useTimelineChromeSources(sources, sourceAudio);

	const view = useStripView(
		"overlay",
		chromeAudio,
		layerColor,
		settings.frequencyRange,
		onFrequencyRangeChange,
		onTransportControlChange,
	);

	return (
		<StripLayout channelInput={channelInput} view={view}>
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
								settings={settings}
								channelInput={channelInput}
								source={source}
								audioData={audioData}
								opacity={0.5}
							/>
						))}
					</div>
					<StripOverlays view={view} settings={settings} />
				</>
			)}
		</StripLayout>
	);
}
