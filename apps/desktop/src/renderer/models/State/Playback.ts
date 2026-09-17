export interface PlaybackState {
	positionSec: number;
	durationSec: number;
	playing: boolean;
	error: string | null;
}

export interface PlaybackControls {
	readonly onPlayToggle: () => void;
	readonly onSeek: (sec: number) => void;
	readonly onVolumeChange: (volume: number) => void;
}
