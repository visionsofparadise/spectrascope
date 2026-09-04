/**
 * The playback interface `PlaybackEngine` implements. `Comparison.tsx` binds
 * the engine to the Transport through this interface, so the transport wiring
 * is independent of the engine's internals.
 *
 * Position is push, not pull: the player drives a `requestAnimationFrame` loop
 * internally and emits the current position (seconds) and the play/pause
 * transitions through `onPositionChange` / `onPlayingChange`. The host
 * subscribes once and re-renders the Transport from those callbacks.
 */
export interface Player {
	/** Begin (or resume) playback from the current position. */
	play(): Promise<void>;

	/** Pause playback, holding the current position. */
	pause(): void;

	/** Seek to an absolute position in seconds (clamped to `[0, duration]`). */
	seek(sec: number): void;

	/** Set the master / monitor gain — `0` silent, `1` unity. */
	setVolume(volume: number): void;

	/** The total playable duration in seconds (`0` until known). */
	readonly durationSec: number;
	/** Whether playback is currently running. */
	readonly playing: boolean;
	/** The current playback position in seconds. */
	readonly positionSec: number;
	/**
	 * Set (or clear) a loop region in seconds. When set and looping is enabled,
	 * playback wraps from `end` back to `start`. `null` clears the region.
	 */
	setLoopRegion(region: { readonly startSec: number; readonly endSec: number } | null): void;

	/** Enable / disable looping over the loop region (no-op when no region set). */
	setLooping(looping: boolean): void;

	/** Subscribe to position updates (seconds). Returns an unsubscribe function. */
	onPositionChange(listener: (positionSec: number) => void): () => void;

	/** Subscribe to play/pause transitions. Returns an unsubscribe function. */
	onPlayingChange(listener: (playing: boolean) => void): () => void;

	/** Release all audio resources. The player is unusable after this. */
	dispose(): void;
}
