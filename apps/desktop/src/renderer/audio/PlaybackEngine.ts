import type { Player } from "./Player";

/**
 * PlaybackEngine — the single player for every audible view, pointed at a
 * registered `media://stream/<key>/audio.wav` playback body.
 *
 * The engine owns its own state (`playing`, `positionSec`, the loop region) and
 * emits changes through listener callbacks; the desktop host subscribes and
 * feeds the Transport (the `Player` interface). It is pointed at a stream via
 * `setSourceUrl` with a full `media://` URL — the caller (the derived-stream
 * hook) builds the URL from the registered stream key, so the engine no longer
 * constructs it.
 *
 * The audio graph is `HTMLAudioElement` → `MediaElementAudioSourceNode` →
 * `GainNode` → `destination`; the `AudioContext` runs at the browser default
 * rate and the media-element graph resamples the canonical-rate stream body
 * transparently. The `requestAnimationFrame` position loop with
 * selection-region looping is kept.
 */
export class PlaybackEngine implements Player {
	private readonly audio: HTMLAudioElement;
	private readonly audioContext: AudioContext;
	private readonly sourceNode: MediaElementAudioSourceNode;
	private readonly gainNode: GainNode;

	private rafId: number | null = null;

	private readonly positionListeners = new Set<(positionSec: number) => void>();
	private readonly playingListeners = new Set<(playing: boolean) => void>();
	private readonly durationListeners = new Set<(durationSec: number) => void>();

	private loopRegion: { readonly startSec: number; readonly endSec: number } | null = null;
	private looping = false;
	private volume = 0.8;

	constructor() {
		this.audio = new Audio();
		this.audio.crossOrigin = "anonymous";
		this.audio.preload = "auto";

		this.audioContext = new AudioContext();
		this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
		this.gainNode = this.audioContext.createGain();
		this.gainNode.gain.value = this.volume;

		this.sourceNode.connect(this.gainNode);
		this.gainNode.connect(this.audioContext.destination);

		// `ended` covers a non-looping clip reaching its natural end (the rAF
		// loop also catches it, but the element event is the reliable source).
		this.audio.addEventListener("ended", this.handleEnded);

		// `<audio>` reports its duration asynchronously once metadata loads.
		// `durationchange` / `loadedmetadata` are the element's own events for
		// that — subscribing to them is reliable regardless of how long the
		// decode takes (vs a fixed-window poll, which gives up too early on a
		// slow load and leaves the Transport showing `00:00.000` total).
		this.audio.addEventListener("durationchange", this.handleDurationChange);
		this.audio.addEventListener("loadedmetadata", this.handleDurationChange);
	}

	/**
	 * Point the engine at a stream. A change of URL resets the `<audio>` `src`;
	 * the same URL is a no-op so a re-render with an unchanged source does not
	 * reload the element (which would drop the playhead). Returns whether the
	 * source actually changed.
	 */
	setSourceUrl(url: string): boolean {
		if (this.audio.src === url) return false;

		const wasPlaying = !this.audio.paused;

		this.audio.src = url;

		if (wasPlaying) {
			this.emitPlaying(false);
			this.stopRafLoop();
		}

		this.emitPosition(0);

		return true;
	}

	get durationSec(): number {
		return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
	}

	get playing(): boolean {
		return !this.audio.paused;
	}

	get positionSec(): number {
		return this.audio.currentTime;
	}

	async play(): Promise<void> {
		if (!this.audio.src) return;

		if (this.audioContext.state === "suspended") {
			await this.audioContext.resume();
		}

		await this.audio.play();
		this.emitPlaying(true);
		this.startRafLoop();
	}

	pause(): void {
		this.audio.pause();
		this.stopRafLoop();
		this.emitPosition(this.audio.currentTime);
		this.emitPlaying(false);
	}

	seek(sec: number): void {
		const target = Math.max(0, sec);
		const duration = this.durationSec;

		// `durationSec` is `0` until `<audio>` metadata has loaded — the
		// `|| sec` form of the old clamp degenerated to a no-op there and could
		// publish an out-of-range timecode to the Transport. When the duration
		// is known, clamp to it; when it is not, assign the target and emit the
		// element's *actual* `currentTime` (the element clamps the assignment
		// to its own loaded range itself).
		if (duration > 0) {
			const clamped = Math.min(duration, target);

			this.audio.currentTime = clamped;
			this.emitPosition(clamped);

			return;
		}

		this.audio.currentTime = target;
		this.emitPosition(this.audio.currentTime);
	}

	setVolume(volume: number): void {
		this.volume = Math.max(0, Math.min(1, volume));
		this.gainNode.gain.value = this.volume;
	}

	setLoopRegion(region: { readonly startSec: number; readonly endSec: number } | null): void {
		this.loopRegion = region;
	}

	setLooping(looping: boolean): void {
		this.looping = looping;
	}

	onPositionChange(listener: (positionSec: number) => void): () => void {
		this.positionListeners.add(listener);

		return () => this.positionListeners.delete(listener);
	}

	onPlayingChange(listener: (playing: boolean) => void): () => void {
		this.playingListeners.add(listener);

		return () => this.playingListeners.delete(listener);
	}

	/**
	 * Subscribe to duration updates (seconds). The `<audio>` element reports its
	 * duration asynchronously once metadata loads; this fires on every
	 * `durationchange` / `loadedmetadata` with the current `durationSec`.
	 * Returns an unsubscribe function.
	 */
	onDurationChange(listener: (durationSec: number) => void): () => void {
		this.durationListeners.add(listener);

		return () => this.durationListeners.delete(listener);
	}

	dispose(): void {
		this.audio.pause();
		this.stopRafLoop();
		this.audio.removeEventListener("ended", this.handleEnded);
		this.audio.removeEventListener("durationchange", this.handleDurationChange);
		this.audio.removeEventListener("loadedmetadata", this.handleDurationChange);

		this.sourceNode.disconnect();
		this.gainNode.disconnect();
		void this.audioContext.close();

		this.audio.removeAttribute("src");
		this.audio.load();

		this.positionListeners.clear();
		this.playingListeners.clear();
		this.durationListeners.clear();
	}

	/** Start of the loop region (seconds) — `0` when no region or not looping. */
	private loopStartSec(): number {
		if (!this.looping || !this.loopRegion) return 0;

		return this.loopRegion.startSec;
	}

	/** End of the loop region (seconds) — the clip duration when not looping. */
	private loopEndSec(): number {
		if (this.looping && this.loopRegion) return this.loopRegion.endSec;

		return this.durationSec;
	}

	private readonly handleEnded = (): void => {
		this.stopRafLoop();

		if (this.looping && this.loopRegion) {
			// A non-region loop of the whole file is handled in the rAF tick;
			// `ended` only fires for a clip played to its natural end.
			this.audio.currentTime = this.loopStartSec();
			void this.play();

			return;
		}

		this.emitPosition(this.audio.currentTime);
		this.emitPlaying(false);
	};

	private readonly handleDurationChange = (): void => {
		this.emitDuration(this.durationSec);
	};

	private startRafLoop(): void {
		this.stopRafLoop();

		const tick = (): void => {
			const currentSec = this.audio.currentTime;
			const endSec = this.loopEndSec();

			if (endSec > 0 && currentSec >= endSec) {
				if (this.looping) {
					const startSec = this.loopStartSec();

					this.audio.currentTime = startSec;
					this.emitPosition(startSec);
				} else {
					this.audio.pause();
					this.stopRafLoop();
					this.emitPosition(currentSec);
					this.emitPlaying(false);

					return;
				}
			} else {
				this.emitPosition(currentSec);
			}

			this.rafId = requestAnimationFrame(tick);
		};

		this.rafId = requestAnimationFrame(tick);
	}

	private stopRafLoop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	private emitPosition(positionSec: number): void {
		for (const listener of this.positionListeners) {
			listener(positionSec);
		}
	}

	private emitPlaying(playing: boolean): void {
		for (const listener of this.playingListeners) {
			listener(playing);
		}
	}

	private emitDuration(durationSec: number): void {
		for (const listener of this.durationListeners) {
			listener(durationSec);
		}
	}
}
