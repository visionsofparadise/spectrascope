import { describe, expect, it } from "vitest";
import type { TimelineClip } from "./timelineExtent";
import { clipWindowIntersection, computeTimelineExtent } from "./timelineExtent";

const CLIPS: ReadonlyArray<TimelineClip> = [
	{ id: "a", offsetMs: 2000, durationMs: 3000 },
	{ id: "b", offsetMs: 500, durationMs: 1000 },
];

describe("computeTimelineExtent", () => {
	it("hugs earliest start and latest end across clips", () => {
		// b starts earliest (500); a ends latest (2000 + 3000).
		expect(computeTimelineExtent(CLIPS, null)).toEqual({ startMs: 500, endMs: 5000 });
	});

	it("collapses to 0/0 when there are no clips", () => {
		expect(computeTimelineExtent([], null)).toEqual({ startMs: 0, endMs: 0 });
	});

	it("floors a negative stored offset at 0", () => {
		const result = computeTimelineExtent([{ id: "a", offsetMs: -400, durationMs: 1000 }], null);

		expect(result).toEqual({ startMs: 0, endMs: 1000 });
	});

	it("grows the end live when the latest clip is dragged right", () => {
		const result = computeTimelineExtent(CLIPS, { id: "a", offsetMs: 6000 });

		// a now ends at 6000 + 3000; b still the earliest start.
		expect(result).toEqual({ startMs: 500, endMs: 9000 });
	});

	it("shrinks the start when the earliest clip is dragged right", () => {
		const result = computeTimelineExtent(CLIPS, { id: "b", offsetMs: 3000 });

		// b moved to 3000; a is now the earliest start (2000) and still latest end.
		expect(result).toEqual({ startMs: 2000, endMs: 5000 });
	});
});

describe("clipWindowIntersection", () => {
	it.each([
		[0, 10000, { startMs: 0, endMs: 10000 }, { startMs: 0, endMs: 10000 }],
		[2000, 3000, { startMs: 0, endMs: 10000 }, { startMs: 0, endMs: 3000 }],
		[2000, 3000, { startMs: 2500, endMs: 3500 }, { startMs: 500, endMs: 1500 }],
		[2000, 3000, { startMs: 1000, endMs: 2500 }, { startMs: 0, endMs: 500 }],
		[2000, 3000, { startMs: 4500, endMs: 6000 }, { startMs: 2500, endMs: 3000 }],
	] as const)("scopes offset %i duration %i to the viewport", (offsetMs, durationMs, window, expected) => {
		expect(clipWindowIntersection(offsetMs, durationMs, window)).toEqual(expected);
	});

	it.each([
		{ startMs: 0, endMs: 2000 },
		{ startMs: 0, endMs: 1000 },
		{ startMs: 5000, endMs: 6000 },
		{ startMs: 6000, endMs: 7000 },
		{ startMs: 3000, endMs: 3000 },
	])("skips offscreen and touching windows: %s", (window) => {
		expect(clipWindowIntersection(2000, 3000, window)).toBeNull();
	});

	it("keeps a one-hour clip scoped to a ten-millisecond viewport", () => {
		const result = clipWindowIntersection(0, 3600000, { startMs: 1800000, endMs: 1800010 });

		expect(result).toEqual({ startMs: 1800000, endMs: 1800010 });
		expect(clipWindowIntersection(0, 0, { startMs: 0, endMs: 1000 })).toBeNull();
	});
});
