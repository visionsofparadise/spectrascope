import { useCallback, useMemo, useState } from "react";
import { Curtain } from "../spectral/Curtain";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import { curtainBounds, defaultCurtainPositions, stripClipPath } from "./sliderClip";
import { useChromeSources } from "./viewAudio";
import type { Source } from "../source";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { ViewControlSettings } from "../viewSettings";
import type { ChannelInput } from "spectral-display";

interface SliderViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly channelInput: ChannelInput;
	readonly settings: ViewControlSettings;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

export function SliderView({
	sources,
	sourceAudio,
	channelInput,
	settings,
	onTransportControlChange,
}: SliderViewProps) {
	const { renderableSources, chromeAudio, layerColor } = useChromeSources(sources, sourceAudio);

	const sourceCount = renderableSources.length;

	const idsKey = useMemo(() => renderableSources.map((entry) => entry.source.id).join("|"), [renderableSources]);

	const [positions, setPositions] = useState<Array<number>>(() => defaultCurtainPositions(sourceCount));
	const [positionsKey, setPositionsKey] = useState(idsKey);

	if (positionsKey !== idsKey) {
		setPositionsKey(idsKey);
		setPositions(defaultCurtainPositions(sourceCount));
	}

	const setCurtainAt = useCallback((index: number, next: number) => {
		setPositions((previous) => {
			const updated = previous.slice();

			updated[index] = next;

			return updated;
		});
	}, []);

	const view = useStripView("slider", chromeAudio, layerColor, onTransportControlChange);

	const hasSources = sourceCount >= 2;

	return (
		<StripLayout view={view}>
			{hasSources ? (
				<>
					<div className="absolute inset-0">
						{renderableSources.map((entry, index) => (
							<StripSourceRender
								key={entry.source.id}
								view={view}
								settings={settings}
								channelInput={channelInput}
								source={entry.source}
								audioData={entry.audioData}
								clipPath={stripClipPath(index, positions, sourceCount)}
							/>
						))}
					</div>
					{positions.map((position, index) => {
						const bounds = curtainBounds(index, positions);

						return (
							<div
								key={renderableSources[index]?.source.id ?? index}
								className="pointer-events-none absolute inset-0"
								style={{ zIndex: positions.length - index }}
							>
								<Curtain
									position={position}
									min={bounds.min}
									max={bounds.max}
									onPositionChange={(next) => {
										setCurtainAt(index, next);
									}}
								/>
							</div>
						);
					})}
					<StripOverlays view={view} settings={settings} />
				</>
			) : (
				<div className="flex h-full items-center justify-center">
					<p className="font-technical text-sm text-chrome-text-dim">Need at least two visible sources</p>
				</div>
			)}
		</StripLayout>
	);
}
