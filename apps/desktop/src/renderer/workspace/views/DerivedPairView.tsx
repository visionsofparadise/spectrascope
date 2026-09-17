import { scope } from "opshot/react";
import { useMemo } from "react";
import { NEUTRAL_LAYER_COLOR } from "../layers";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import { placeAudioOnTimeline } from "../utils/placeAudioOnTimeline";
import { sourcePairOf } from "./sourcePair";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { DerivedSpectralViewProps } from "./viewProps";

interface DerivedPairViewProps extends DerivedSpectralViewProps {
	readonly viewId: "sum" | "difference";
	readonly operator: "+" | "−";
}

export const DerivedPairView = scope<DerivedPairViewProps>(
	({ viewId, operator, sourceAudio, derivedAudio, onTransportControlChange, context }: DerivedPairViewProps) => {
		const { document } = context.session;
		const { sources, channelInput, renderSettings, differenceA, differenceB } = document;
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

		const view = useStripView(derivedAudio, onTransportControlChange, context);

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
			<StripLayout channelInput={channelInput} view={view} minimapSources={minimapSources} context={context}>
				{pair.a !== null && (
					<>
						<div className="absolute inset-0">
							<StripSourceRender
								view={view}
								settings={renderSettings}
								channelInput={channelInput}
								source={derivedSource}
								audioData={derivedAudio}
							/>
						</div>
						<StripOverlays view={view} settings={renderSettings} />
					</>
				)}
			</StripLayout>
		);
	},
);
