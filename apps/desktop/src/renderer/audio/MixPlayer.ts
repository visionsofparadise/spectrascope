import type { Player } from "./Player";

/**
 * One source in the live mix — its decoded `AudioBuffer` and where it sits on
 * the comparison's shared timeline.
 */
export interface MixSource {
	readonly id: string;
	readonly audioBuffer: AudioBuffer;
	/** The source's start on the shared timeline, milliseconds, ≥ 0. */
	readonly timelineOffsetMs: number;
}

/**
 * How one source should be scheduled for a run starting at logical timeline
 * position `fromSec` — the pure scheduling decision, separated from the Web
 * Audio node wiring so it can be unit-tested without an `AudioContext`.
 *
 * - `skip` — the source's whole span is behind the playhead; nothing to play.
 * - `startDelaySec` — seconds to wait (from the run's context-start time)
 *   before the node starts. `0` when the playhead is already inside the span.
 * - `bufferOffsetSec` — where in the source's own buffer the node begins. `0`
 *   when the source has not started yet (the playhead reaches it later).
 */
export interface SourceSchedule {
	readonly skip: boolean;
	readonly startDelaySec: number;
	readonly bufferOffsetSec: number;
}

/**
 * Resolve how a source sitting at `offsetSec` on the timeline, with a buffer of
 * `bufferDurationSec`, is scheduled for a run starting at `fromSec`.
 *
 * Three cases:
 * - the source ends before `fromSec` → `skip` (already over);
 * - the source starts at or after `fromSec` → wait `offsetSec - fromSec`, play
 *   from the head of the buffer;
 * - the playhead is partway through the source → start immediately, from a
 *   buffer offset of `fromSec - offsetSec`.
 */
export function scheduleSource(offsetSec: number, bufferDurationSec: number, fromSec: number): SourceSchedule {
	const sourceEndSec = offsetSec + bufferDurationSec;

	if (sourceEndSec <= fromSec) {
		return { skip: true, startDelaySec: 0, bufferOffsetSec: 0 };
	}

	if (offsetSec >= fromSec) {
		return { skip: false, startDelaySec: offsetSec - fromSec, bufferOffsetSec: 0 };
	}

	return { skip: false, startDelaySec: 0, bufferOffsetSec: fromSec - offsetSec };
}

/**
 * MixPlayer — plays a live Web Audio mix of the audible source buffers.
 *
 * Where `PlaybackEngine` auditions one rendered file (the Sum / Difference temp
 * file), `MixPlayer` is the playback path for the per-source and chart views:
 * it builds an `AudioBufferSourceNode` per audible source, scheduled at that
 * source's `timelineOffsetMs`, summed through a master `GainNode` to the
 * destination. No ffmpeg render and no temp file — the source `AudioBuffer`s
 * are already decoded in memory for display, and a live mix reflects mute /
 * solo and timeline-offset edits instantly (the host rebuilds the player when
 * the audible set changes).
 *
 * It implements the same `Player` interface as `PlaybackEngine` so the
 * Transport wiring in `Comparison.tsx` is uniform across both playback paths.
 *
 * Web Audio `AudioBufferSourceNode`s are one-shot — they cannot be paused and
 * resumed. So the player tracks a logical position itself: `pause`/`seek` stop
 * every live node and record the position; `play` schedules a fresh set of
 * nodes positioned relative to the current logical position. Position is read
 * from `AudioContext.currentTime` against the context-time the run started.
 */
export class MixPlayer implements Player {
	private readonly audioContext: AudioContext;
	private readonly gainNode: GainNode;

	private readonly sources: ReadonlyArray<MixSource>;
	/** Total timeline duration in seconds — `max(offset + buffer length)`. */
	private readonly totalDurationSec: number;

	/** Live source nodes for the current run — empty while paused. */
	private activeNodes: Array<AudioBufferSourceNode> = [];

	private isPlaying = false;
	/** Logical position (seconds) at the moment the current run started — the seek baseline. */
	private runStartPositionSec = 0;
	/** `AudioContext.currentTime` at the moment the current run started. */
	private runStartContextTime = 0;
	/** Logical position (seconds) while paused. */
	private pausedPositionSec = 0;

	private rafId: number | null = null;
	private volume = 0.8;

	private loopRegion: { readonly startSec: number; readonly endSec: number } | null = null;
	private looping = false;

	private readonly positionListeners = new Set<(positionSec: number) => void>();
	private readonly playingListeners = new Set<(playing: boolean) => void>();

	constructor(sources: ReadonlyArray<MixSource>) {
		this.sources = sources;
		this.audioContext = new AudioContext();
		this.gainNode = this.audioContext.createGain();
		this.gainNode.gain.value = this.volume;
		this.gainNode.connect(this.audioContext.destination);

		let durationSec = 0;

		for (const source of sources) {
			const endSec = Math.max(0, source.timelineOffsetMs) / 1000 + source.audioBuffer.duration;

			durationSec = Math.max(durationSec, endSec);
		}

		this.totalDurationSec = durationSec;
	}

	get durationSec(): number {
		return this.totalDurationSec;
	}

	get playing(): boolean {
		return this.isPlaying;
	}

	get positionSec(): number {
		if (!this.isPlaying) return this.pausedPositionSec;

		return this.runStartPositionSec + (this.audioContext.currentTime - this.runStartContextTime);
	}

	async play(): Promise<void> {
		if (this.isPlaying || this.sources.length === 0) return;

		if (this.audioContext.state === "suspended") {
			await this.audioContext.resume();
		}

		this.startRun(this.pausedPositionSec);
		this.isPlaying = true;
		this.emitPlaying(true);
		this.startRafLoop();
	}

	pause(): void {
		if (!this.isPlaying) return;

		this.pausedPositionSec = this.positionSec;
		this.stopRun();
		this.isPlaying = false;
		this.stopRafLoop();
		this.emitPosition(this.pausedPositionSec);
		this.emitPlaying(false);
	}

	seek(sec: number): void {
		const clamped = Math.max(0, Math.min(this.totalDurationSec || sec, sec));

		if (this.isPlaying) {
			// Re-schedule the run from the new position — one-shot nodes cannot
			// be retimed in place.
			this.stopRun();
			this.startRun(clamped);
		} else {
			this.pausedPositionSec = clamped;
		}

		this.emitPosition(clamped);
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

	dispose(): void {
		this.stopRun();
		this.stopRafLoop();
		this.gainNode.disconnect();
		void this.audioContext.close();
		this.positionListeners.clear();
		this.playingListeners.clear();
	}

	/**
	 * Schedule a fresh set of source nodes for a run starting at logical
	 * position `fromSec`. Each source is placed relative to its timeline offset:
	 * a source whose span has not been reached yet starts in the future; a
	 * source already underway starts immediately from a buffer offset; a source
	 * already finished is not scheduled.
	 */
	private startRun(fromSec: number): void {
		const now = this.audioContext.currentTime;

		this.runStartPositionSec = fromSec;
		this.runStartContextTime = now;
		this.activeNodes = [];

		for (const source of this.sources) {
			const offsetSec = Math.max(0, source.timelineOffsetMs) / 1000;
			const schedule = scheduleSource(offsetSec, source.audioBuffer.duration, fromSec);

			// The source's whole span is behind the playhead — nothing to play.
			if (schedule.skip) continue;

			const node = this.audioContext.createBufferSource();

			node.buffer = source.audioBuffer;
			node.connect(this.gainNode);
			node.start(now + schedule.startDelaySec, schedule.bufferOffsetSec);

			this.activeNodes.push(node);
		}
	}

	/** Stop and discard every live source node. */
	private stopRun(): void {
		for (const node of this.activeNodes) {
			node.disconnect();

			try {
				node.stop();
			} catch {
				// `stop()` throws if the node was never started or already
				// stopped — harmless during teardown.
			}
		}

		this.activeNodes = [];
	}

	/** Start of the loop region (seconds) — `0` when no region or not looping. */
	private loopStartSec(): number {
		if (!this.looping || !this.loopRegion) return 0;

		return this.loopRegion.startSec;
	}

	/** End of the loop region (seconds) — the mix duration when not looping. */
	private loopEndSec(): number {
		if (this.looping && this.loopRegion) return this.loopRegion.endSec;

		return this.totalDurationSec;
	}

	private startRafLoop(): void {
		this.stopRafLoop();

		const tick = (): void => {
			const currentSec = this.positionSec;
			const endSec = this.loopEndSec();

			if (endSec > 0 && currentSec >= endSec) {
				if (this.looping) {
					const startSec = this.loopStartSec();

					this.stopRun();
					this.startRun(startSec);
					this.emitPosition(startSec);
				} else {
					this.pausedPositionSec = endSec;
					this.stopRun();
					this.isPlaying = false;
					this.stopRafLoop();
					this.emitPosition(endSec);
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
}
