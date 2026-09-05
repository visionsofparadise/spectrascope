export interface Player {
	play(): Promise<void>;

	pause(): void;

	seek(sec: number): void;

	setVolume(volume: number): void;

	readonly durationSec: number;
	readonly playing: boolean;
	readonly positionSec: number;
	setLoopRegion(region: { readonly startSec: number; readonly endSec: number } | null): void;

	setLooping(looping: boolean): void;

	onPositionChange(listener: (positionSec: number) => void): () => void;

	onPlayingChange(listener: (playing: boolean) => void): () => void;

	dispose(): void;
}
