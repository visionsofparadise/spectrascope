import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSource } from "../source";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "../viewSettings";
import { TimelineView } from "./TimelineView";
import { EMPTY_AUDIO_DATA } from "./viewAudio";
import type { SpectralOptions } from "spectral-display";

const compute = vi.hoisted(() => vi.fn<(options: SpectralOptions) => { status: "idle" }>(() => ({ status: "idle" })));

vi.mock("spectral-display", () => ({
	useSpectralCompute: compute,
	SpectrogramCanvas: () => null,
	WaveformCanvas: () => null,
}));

vi.mock("../useTimeViewport", async (importOriginal) => ({
	...(await importOriginal<typeof import("../useTimeViewport")>()),
	useTimeViewport: () => ({
		startMs: 1800000,
		endMs: 1800010,
		committedStartMs: 1800000,
		committedEndMs: 1800010,
		wheelHandlers: { ref: { current: null } },
		setViewport: () => {},
	}),
}));

vi.mock("../playback", () => ({
	useWorkspacePlayback: () => ({
		positionSec: 0,
		durationSec: 3600,
		playing: false,
		onPlayToggle: () => {},
		onSeek: () => {},
		selection: null,
		onSelectionChange: () => {},
	}),
}));

describe("Timeline viewport rendering", () => {
	beforeEach(() => compute.mockClear());

	it("queries a ten-millisecond slice of a one-hour clip and skips an offscreen clip", () => {
		const longSource = createDefaultSource(0, { id: "long" });
		const hiddenSource = createDefaultSource(1, { id: "offscreen" });
		const html = renderToStaticMarkup(
			createElement(TimelineView, {
				sources: [longSource, hiddenSource],
				sourceAudio: new Map([
					["long", { ...EMPTY_AUDIO_DATA, durationMs: 3600000, totalSamples: 172800000 }],
					["offscreen", { ...EMPTY_AUDIO_DATA, durationMs: 1000, totalSamples: 48000 }],
				]),
				channelInput: "mono",
				settings: INITIAL_VIEW_CONTROL_SETTINGS,
			}),
		);
		const clipQueries = compute.mock.calls
			.map(([options]) => options)
			.filter((options) => options.config?.spectrogram !== false);

		expect(clipQueries).toHaveLength(1);
		expect(clipQueries[0]?.query).toEqual({ startMs: 1800000, endMs: 1800010, width: 800, height: 400 });
		expect(html).toContain("left:0%;width:100%");
	});

	it("lays out a partially visible clip within the track and queries clip-local time", () => {
		const source = createDefaultSource(0, { id: "partial", timelineOffsetMs: 1800005 });
		const html = renderToStaticMarkup(
			createElement(TimelineView, {
				sources: [source],
				sourceAudio: new Map([["partial", { ...EMPTY_AUDIO_DATA, durationMs: 1000, totalSamples: 48000 }]]),
				channelInput: "side",
				settings: INITIAL_VIEW_CONTROL_SETTINGS,
			}),
		);
		const clipQuery = compute.mock.calls.find(([options]) => options.config?.spectrogram !== false)?.[0];

		expect(clipQuery?.query).toEqual({ startMs: 0, endMs: 5, width: 800, height: 400 });
		expect(clipQuery?.config?.channelInput).toBe("side");
		expect(html).toContain("left:50%;width:50%");
	});
});
