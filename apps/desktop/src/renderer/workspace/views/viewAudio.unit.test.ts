import { describe, expect, it } from "vitest";
import { createDefaultSource } from "../source";
import { comparisonDurationOf, EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";

describe("comparison source extent", () => {
	it("includes a longer later source and its placement", () => {
		const first = createDefaultSource(0, { id: "first", timelineOffsetMs: 1000 });
		const last = createDefaultSource(1, { id: "last", timelineOffsetMs: 5000 });
		const resolved = resolveVisibleSourceAudio(
			[first, last],
			new Map([
				["first", { ...EMPTY_AUDIO_DATA, durationMs: 2000 }],
				["last", { ...EMPTY_AUDIO_DATA, durationMs: 10000 }],
			]),
		);

		expect(comparisonDurationOf(resolved)).toBe(15000);
	});

	it("excludes hidden or unprepared sources", () => {
		const hidden = createDefaultSource(0, { id: "hidden", visible: false });
		const absent = createDefaultSource(1, { id: "absent" });

		expect(
			comparisonDurationOf(
				resolveVisibleSourceAudio(
					[hidden, absent],
					new Map([["hidden", { ...EMPTY_AUDIO_DATA, durationMs: 10000 }]]),
				),
			),
		).toBe(0);
	});
});
