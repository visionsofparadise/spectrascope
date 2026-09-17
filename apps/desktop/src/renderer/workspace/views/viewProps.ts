import type { SourceStreamStatus } from "../../audio/useSourceStreams";
import type { SessionContext } from "../../models/Context";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";

export interface SourceViewProps {
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
	readonly context: SessionContext;
}
export interface DerivedSpectralViewProps extends SourceViewProps {
	readonly derivedAudio: AudioData;
}
export interface SourceManagementProps {
	readonly sourceStatus?: ReadonlyMap<string, SourceStreamStatus>;
	readonly sourceErrors?: ReadonlyMap<string, string>;
	readonly onRetrySource?: (sourceId: string) => void;
	readonly onRelinkSource?: (sourceId: string) => void;
}
