import { useMemo } from "react";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import type { LayerColor } from "../layers";
import type { Source } from "../source";
import type { DerivedSpectralViewProps } from "./viewProps";

const SUM_LAYER_COLOR: LayerColor = {
	primary: "#A3E635",
	secondary: "#440154",
};

export function SumView({
	sources,
	derivedAudio,
	channelInput,
	settings,
	onFrequencyRangeChange,
	onTransportControlChange,
}: DerivedSpectralViewProps) {
	const view = useStripView(
		"sum",
		derivedAudio,
		SUM_LAYER_COLOR,
		settings.frequencyRange,
		onFrequencyRangeChange,
		onTransportControlChange,
	);

	const visibleSources = useMemo(() => sources.filter((source) => source.visible), [sources]);

	const sumSource = useMemo<Source>(
		() => ({
			id: "sum",
			name: "Σ all sources",
			audioFilePath: "derived",
			timelineOffsetMs: 0,
			layerColor: SUM_LAYER_COLOR,
			visible: true,
			muted: false,
			soloed: false,
		}),
		[],
	);

	return (
		<StripLayout channelInput={channelInput} view={view}>
			{visibleSources.length === 0 ? (
				<div className="flex h-full items-center justify-center">
					<p className="font-technical text-sm text-chrome-text-dim">No visible sources</p>
				</div>
			) : (
				<>
					<div className="absolute inset-0">
						<StripSourceRender
							view={view}
							settings={settings}
							channelInput={channelInput}
							source={sumSource}
							audioData={derivedAudio}
						/>
					</div>
					<StripOverlays view={view} settings={settings} />
				</>
			)}
		</StripLayout>
	);
}
