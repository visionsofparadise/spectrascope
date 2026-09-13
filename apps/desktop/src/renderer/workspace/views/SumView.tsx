import { useMemo } from "react";
import { THEME_PALETTES } from "../../utils/themePalettes";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import type { LayerColor } from "../layers";
import type { Source } from "../source";
import type { DerivedSpectralViewProps } from "./viewProps";

export function SumView({
	sources,
	derivedAudio,
	channelInput,
	settings,
	theme,
	onFrequencyRangeChange,
	onTransportControlChange,
}: DerivedSpectralViewProps) {
	const layerColor = useMemo<LayerColor>(
		() => ({ primary: THEME_PALETTES[theme].accent, secondary: THEME_PALETTES[theme].tint }),
		[theme],
	);
	const view = useStripView(
		"sum",
		derivedAudio,
		layerColor,
		settings.frequencyRange,
		settings.frequencyScale,
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
			layerColor,
			visible: true,
			muted: false,
			soloed: false,
		}),
		[layerColor],
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
