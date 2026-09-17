import { useMemo } from "react";
import { NEUTRAL_LAYER_COLOR } from "../layers";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import { placeAudioOnTimeline } from "../utils/placeAudioOnTimeline";
import { sourcePairOf } from "./sourcePair";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { DerivedSpectralViewProps, DifferenceSelectionProps } from "./viewProps";

interface DerivedPairViewProps extends DerivedSpectralViewProps, DifferenceSelectionProps {
	readonly viewId: "sum" | "difference";
	readonly operator: "+" | "−";
}

export function DerivedPairView({
	viewId,
	operator,
	sources,
	sourceAudio,
	derivedAudio,
	channelInput,
	settings,
	differenceA,
	differenceB,
	onFrequencyRangeChange,
	onTransportControlChange,
}: DerivedPairViewProps) {
	const pair = useMemo(() => sourcePairOf(sources, differenceA, differenceB), [sources, differenceA, differenceB]);
	const layerColor = sources.find((source) => source.id === pair.a)?.layerColor ?? NEUTRAL_LAYER_COLOR;
	const minimapSources = useMemo(
		() =>
			resolveVisibleSourceAudio(sources, sourceAudio).map(({ source, audioData }) => ({
				source,
				audioData: placeAudioOnTimeline(audioData, source.timelineOffsetMs, derivedAudio.durationMs),
			})),
		[sources, sourceAudio, derivedAudio.durationMs],
	);

	const view = useStripView(
		derivedAudio,
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
		<StripLayout channelInput={channelInput} view={view} minimapSources={minimapSources}>
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
