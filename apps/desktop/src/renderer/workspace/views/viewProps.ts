import type { ThemeId } from "../../utils/themePalettes";
import type { Source } from "../source";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { ViewControlSettings } from "../viewSettings";
import type { ChannelInput, TextureVerticalRange } from "spectral-display";

export interface SourceViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}
export interface SpectralViewControls {
	readonly channelInput: ChannelInput;
	readonly settings: ViewControlSettings;
	readonly onFrequencyRangeChange: (range: TextureVerticalRange) => void;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}
export interface PerSourceSpectralViewProps extends SourceViewProps, SpectralViewControls {}
export interface DerivedSpectralViewProps extends SpectralViewControls {
	readonly sources: ReadonlyArray<Source>;
	readonly derivedAudio: AudioData;
	readonly theme: ThemeId;
}
export interface DifferenceSelectionProps {
	readonly differenceA: string | null;
	readonly differenceB: string | null;
	readonly onDifferenceChange: (differenceA: string, differenceB: string) => void;
}
