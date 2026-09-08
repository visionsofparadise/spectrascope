import type { Player } from "./Player";

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
	private knownDurationSec = 0;
	private pendingSeek: number | null = null;
	private generation = 0;
	private readonly errorListeners = new Set<(message: string) => void>();

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

		this.audio.addEventListener("ended", this.handleEnded);

		this.audio.addEventListener("durationchange", this.handleDurationChange);
		this.audio.addEventListener("loadedmetadata", this.handleDurationChange);
		this.audio.addEventListener("error", this.handleError);
	}

	setSourceUrl(url: string, positionSec = 0, durationSec = 0): boolean {
		if (this.audio.src === url) return false;

		this.generation += 1;
		this.audio.pause();
		this.stopRafLoop();
		this.knownDurationSec = Math.max(0, durationSec);
		this.pendingSeek = Math.max(0, Math.min(positionSec, durationSec > 0 ? durationSec : positionSec));

		// eslint-disable-next-line id-denylist
		this.audio.src = url;

		this.emitPlaying(false);
		this.emitPosition(this.pendingSeek);

		return true;
	}

	get durationSec(): number {
		return this.knownDurationSec > 0
			? this.knownDurationSec
			: Number.isFinite(this.audio.duration)
				? this.audio.duration
				: 0;
	}

	get playing(): boolean {
		return !this.audio.paused;
	}

	get positionSec(): number {
		return this.pendingSeek ?? this.audio.currentTime;
	}

	async play(): Promise<void> {
		if (!this.audio.src) return;

		const generation = ++this.generation;

		try {
			if (this.audioContext.state === "suspended") await this.audioContext.resume();

			if (generation !== this.generation) return;

			const startSec = this.loopStartSec();
			const endSec = this.loopEndSec();

			if ((this.looping && this.positionSec < startSec) || (endSec > 0 && this.positionSec >= endSec)) {
				this.seek(startSec);
			}

			await this.audio.play();
		} catch (error: unknown) {
			if (generation !== this.generation) return;

			throw error;
		}

		if (generation !== this.generation) return;

		this.emitPlaying(true);
		this.startRafLoop();
	}

	pause(): void {
		this.generation += 1;
		this.audio.pause();
		this.stopRafLoop();
		this.emitPosition(this.positionSec);
		this.emitPlaying(false);
	}

	seek(sec: number): void {
		const target = Number.isFinite(sec) ? Math.max(0, sec) : 0;
		const duration = this.durationSec;
		const clamped = duration > 0 ? Math.min(duration, target) : target;

		this.pendingSeek = clamped;

		if (this.audio.readyState >= 1) {
			this.audio.currentTime = clamped;
			this.pendingSeek = null;
		}

		this.emitPosition(clamped);
	}

	setVolume(volume: number): void {
		this.volume = Math.max(0, Math.min(1, volume));
		this.gainNode.gain.value = this.volume;
	}

	setPlaybackRate(rate: number): void {
		this.audio.playbackRate = Number.isFinite(rate) ? Math.max(0.25, Math.min(2, rate)) : 1;
	}

	onError(listener: (message: string) => void): () => void {
		this.errorListeners.add(listener);

		return () => this.errorListeners.delete(listener);
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

	onDurationChange(listener: (durationSec: number) => void): () => void {
		this.durationListeners.add(listener);

		return () => this.durationListeners.delete(listener);
	}

	dispose(): void {
		this.generation += 1;
		this.audio.pause();
		this.stopRafLoop();
		this.audio.removeEventListener("ended", this.handleEnded);
		this.audio.removeEventListener("durationchange", this.handleDurationChange);
		this.audio.removeEventListener("loadedmetadata", this.handleDurationChange);
		this.audio.removeEventListener("error", this.handleError);

		this.sourceNode.disconnect();
		this.gainNode.disconnect();
		void this.audioContext.close();

		this.audio.removeAttribute("src");
		this.audio.load();

		this.positionListeners.clear();
		this.playingListeners.clear();
		this.durationListeners.clear();
		this.errorListeners.clear();
	}

	private normalizedLoopRegion(): { startSec: number; endSec: number } | null {
		if (!this.looping || !this.loopRegion) return null;

		const { startSec, endSec } = this.loopRegion;

		if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null;

		const duration = this.durationSec;
		const start = Math.max(0, Math.min(duration, startSec));
		const end = Math.max(0, Math.min(duration, endSec));

		return end > start ? { startSec: start, endSec: end } : null;
	}

	private loopStartSec(): number {
		return this.normalizedLoopRegion()?.startSec ?? 0;
	}

	private loopEndSec(): number {
		return this.normalizedLoopRegion()?.endSec ?? this.durationSec;
	}

	private readonly handleEnded = (): void => {
		this.stopRafLoop();

		if (this.looping) {
			this.seek(this.loopStartSec());
			void this.play().catch(this.reportPlayError);

			return;
		}

		this.emitPosition(this.audio.currentTime);
		this.emitPlaying(false);
	};

	private readonly handleDurationChange = (): void => {
		if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) this.knownDurationSec = this.audio.duration;

		if (this.pendingSeek !== null && this.audio.readyState >= 1) this.seek(this.pendingSeek);

		this.emitDuration(this.durationSec);
	};

	private readonly reportPlayError = (error: unknown): void => {
		this.pause();

		for (const listener of this.errorListeners) listener(error instanceof Error ? error.message : String(error));
	};

	private readonly handleError = (): void => {
		const code = this.audio.error?.code;

		this.reportPlayError(
			new Error(
				code === 4
					? "This audio stream cannot be played. Try a different source format."
					: "Audio playback failed. Retry playback or reload the source.",
			),
		);
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
