import { useMemo } from "react";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import { sourcePairOf } from "./sourcePair";
import type { LayerColor } from "../layers";
import type { Source } from "../source";
import type { DerivedSpectralViewProps, DifferenceSelectionProps } from "./viewProps";

interface DerivedPairViewProps extends Omit<DerivedSpectralViewProps, "theme">, DifferenceSelectionProps {
	readonly viewId: "sum" | "difference";
	readonly operator: "+" | "−";
	readonly layerColorOf: (pairA: Source | undefined) => LayerColor;
}

export function DerivedPairView({
	viewId,
	operator,
	layerColorOf,
	sources,
	derivedAudio,
	channelInput,
	settings,
	differenceA,
	differenceB,
	onFrequencyRangeChange,
	onTransportControlChange,
}: DerivedPairViewProps) {
	const pair = useMemo(() => sourcePairOf(sources, differenceA, differenceB), [sources, differenceA, differenceB]);
	const layerColor = layerColorOf(sources.find((source) => source.id === pair.a));

	const view = useStripView(
		viewId,
		derivedAudio,
		layerColor,
		settings.frequencyRange,
		settings.frequencyScale,
		onFrequencyRangeChange,
		onTransportControlChange,
	);

	const derivedSource = useMemo<Source>(
		() => ({
			id: viewId,
			name: pair.b === null ? "A" : `A ${operator} B`,
			audioFilePath: "derived",
			timelineOffsetMs: 0,
			layerColor,
			visible: true,
			muted: false,
			soloed: false,
		}),
		[viewId, operator, layerColor, pair.b],
	);

	return (
		<StripLayout channelInput={channelInput} view={view}>
			{pair.a !== null && (
				<>
					<div className="absolute inset-0">
						<StripSourceRender
							view={view}
							settings={settings}
							channelInput={channelInput}
							source={derivedSource}
							audioData={derivedAudio}
						/>
					</div>
					<StripOverlays view={view} settings={settings} />
				</>
			)}
		</StripLayout>
	);
}
