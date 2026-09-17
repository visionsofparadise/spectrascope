import type { SourceStreamStatus } from "../../audio/useSourceStreams";
import type { SourceState } from "../../models/State/App";
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
export interface DerivedSpectralViewProps extends SourceViewProps, SpectralViewControls {
	readonly derivedAudio: AudioData;
}
export interface DifferenceSelectionProps {
	readonly differenceA: string | null;
	readonly differenceB: string | null;
}
export interface SourceManagementProps {
	readonly sourceStatus?: ReadonlyMap<string, SourceStreamStatus>;
	readonly sourceErrors?: ReadonlyMap<string, string>;
	readonly onRetrySource?: (sourceId: string) => void;
	readonly onRelinkSource?: (sourceId: string) => void;
	readonly onSourceChange?: (sourceId: string, changes: Partial<SourceState>) => void;
	readonly onSourceRemove?: (sourceId: string) => void;
	readonly onAddSources?: () => void;
	readonly onAddSourceFiles?: (filePaths: ReadonlyArray<string>) => void;
}
