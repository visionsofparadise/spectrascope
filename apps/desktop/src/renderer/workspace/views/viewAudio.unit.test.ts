import { describe, expect, it, vi } from "vitest";
import { createDefaultSource } from "../source";
import {
	comparisonDurationOf,
	EMPTY_AUDIO_DATA,
	resolveVisibleSourceAudio,
	useTimelineChromeSources,
} from "./viewAudio";

vi.mock("react", () => ({ useMemo: (compute: () => unknown) => compute() }));

describe("comparison source extent", () => {
	it("keeps Timeline raw-reader identity when mounting a zero-offset Overlay or Loudness view", () => {
		const source = createDefaultSource(0, { id: "first", timelineOffsetMs: 0 });
		const audio = { ...EMPTY_AUDIO_DATA, durationMs: 2000, totalSamples: 96000 };
		const sourceAudio = new Map([[source.id, audio]]);
		const firstView = useTimelineChromeSources([source], sourceAudio);
		const nextView = useTimelineChromeSources([{ ...source }], sourceAudio);

		expect(firstView.chromeAudio).toBe(audio);
		expect(nextView.renderableSources[0]?.audioData.readSamples).toBe(audio.readSamples);
	});

	it("shares padded readers across fresh view mounts and source-name changes", () => {
		const source = createDefaultSource(0, { id: "placed", timelineOffsetMs: 1000 });
		const audio = { ...EMPTY_AUDIO_DATA, durationMs: 2000, totalSamples: 96000 };
		const sourceAudio = new Map([[source.id, audio]]);
		const firstView = useTimelineChromeSources([source], sourceAudio);
		const nextView = useTimelineChromeSources([{ ...source, name: "Renamed" }], sourceAudio);
		const movedView = useTimelineChromeSources([{ ...source, timelineOffsetMs: 2000 }], sourceAudio);

		expect(firstView.chromeAudio).not.toBe(audio);
		expect(nextView.chromeAudio.readSamples).toBe(firstView.chromeAudio.readSamples);
		expect(nextView.renderableSources[0]?.source.name).toBe("Renamed");
		expect(movedView.chromeAudio.readSamples).not.toBe(firstView.chromeAudio.readSamples);
	});

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
