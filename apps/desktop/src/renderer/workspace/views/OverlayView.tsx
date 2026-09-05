import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import { useChromeSources } from "./viewAudio";
import type { Source } from "../source";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { ViewControlSettings } from "../viewSettings";
import type { ChannelInput } from "spectral-display";

interface OverlayViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly channelInput: ChannelInput;
	readonly settings: ViewControlSettings;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

export function OverlayView({
	sources,
	sourceAudio,
	channelInput,
	settings,
	onTransportControlChange,
}: OverlayViewProps) {
	const { renderableSources, chromeAudio, layerColor } = useChromeSources(sources, sourceAudio);

	const view = useStripView("overlay", chromeAudio, layerColor, onTransportControlChange);

	return (
		<StripLayout view={view}>
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
