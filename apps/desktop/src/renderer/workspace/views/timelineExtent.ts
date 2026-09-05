export interface TimelineClip {
	readonly id: string;
	readonly offsetMs: number;
	readonly durationMs: number;
}

export interface TimelineDrag {
	readonly id: string;
	readonly offsetMs: number;
}

export interface TimelineExtent {
	readonly startMs: number;
	readonly endMs: number;
}

export function computeTimelineExtent(clips: ReadonlyArray<TimelineClip>, drag: TimelineDrag | null): TimelineExtent {
	if (clips.length === 0) return { startMs: 0, endMs: 0 };

	let startMs = Number.POSITIVE_INFINITY;
	let endMs = 0;

	for (const clip of clips) {
		const rawOffset = drag?.id === clip.id ? drag.offsetMs : clip.offsetMs;
		const offsetMs = Math.max(0, rawOffset);

		if (offsetMs < startMs) startMs = offsetMs;

		if (offsetMs + clip.durationMs > endMs) endMs = offsetMs + clip.durationMs;
	}

	return { startMs: startMs === Number.POSITIVE_INFINITY ? 0 : startMs, endMs };
}
