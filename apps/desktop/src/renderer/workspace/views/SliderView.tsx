import { useMemo, useState } from "react";
import { Curtain } from "../spectral/Curtain";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import { stripClipPath } from "./sliderClip";
import { sourcePairOf } from "./sourcePair";
import { SourcePairSelector } from "./SourcePairSelector";
import { useTimelineChromeSources } from "./viewAudio";
import type { DifferenceSelectionProps, PerSourceSpectralViewProps } from "./viewProps";

interface SliderViewProps extends PerSourceSpectralViewProps, DifferenceSelectionProps {}

export function SliderView({
	sources,
	sourceAudio,
	channelInput,
	settings,
	differenceA,
	differenceB,
	onDifferenceChange,
	onFrequencyRangeChange,
	onTransportControlChange,
}: SliderViewProps) {
	const { renderableSources, chromeAudio, layerColor } = useTimelineChromeSources(sources, sourceAudio);
	const pair = useMemo(() => sourcePairOf(sources, differenceA, differenceB), [sources, differenceA, differenceB]);
	const pairEntries = useMemo(
		() =>
			[pair.a, pair.b].flatMap((id) => {
				const entry = id === null ? undefined : renderableSources.find((candidate) => candidate.source.id === id);

				return entry ? [entry] : [];
			}),
		[pair.a, pair.b, renderableSources],
	);
	const highestRateEntry = pairEntries.reduce<(typeof pairEntries)[number] | undefined>(
		(highest, entry) => (!highest || entry.audioData.sampleRate > highest.audioData.sampleRate ? entry : highest),
		undefined,
	);

	const [curtain, setCurtain] = useState(0.5);

	const view = useStripView(
		"slider",
		highestRateEntry?.audioData ?? chromeAudio,
		highestRateEntry?.source.layerColor ?? layerColor,
		settings.frequencyRange,
		settings.frequencyScale,
		onFrequencyRangeChange,
		onTransportControlChange,
	);

	const count = pairEntries.length;

	return (
		<StripLayout
			channelInput={channelInput}
			view={view}
			header={<SourcePairSelector sources={sources} pair={pair} onPairChange={onDifferenceChange} />}
		>
			{count > 0 ? (
				<>
					<div className="absolute inset-0">
						{pairEntries.map((entry, index) => (
							<StripSourceRender
								key={index}
								view={view}
								settings={settings}
								channelInput={channelInput}
								source={entry.source}
								audioData={entry.audioData}
								clipPath={count > 1 ? stripClipPath(index, [curtain], count) : undefined}
							/>
						))}
					</div>
					{count > 1 && (
						<div className="pointer-events-none absolute inset-0">
							<Curtain position={curtain} min={0} max={1} onPositionChange={setCurtain} />
						</div>
					)}
					<StripOverlays view={view} settings={settings} />
				</>
			) : (
				<div className="flex h-full items-center justify-center">
					<p className="font-technical text-sm text-chrome-text-dim">No visible sources</p>
				</div>
			)}
		</StripLayout>
	);
}
