import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSource } from "../source";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "../viewSettings";
import { trackStackStyleOf, TimelineView, visibleTracksOf } from "./TimelineView";
import { EMPTY_AUDIO_DATA } from "./viewAudio";
import type { SpectralOptions } from "spectral-display";

const compute = vi.hoisted(() =>
	vi.fn<(options: SpectralOptions) => { status: "idle"; fraction: number; tiles: [] }>(() => ({
		status: "idle",
		fraction: 0,
		tiles: [],
	})),
);
const viewportCalls = vi.hoisted(() => vi.fn());

vi.mock("spectral-display", async (importOriginal) => ({
	...(await importOriginal<typeof import("spectral-display")>()),
	useDisplayCompute: compute,
	SpectrogramCanvas: () => null,
	WaveformCanvas: () => null,
}));

vi.mock("../useTimeViewport", async (importOriginal) => ({
	...(await importOriginal<typeof import("../useTimeViewport")>()),
	useTimeViewport: (...args: ReadonlyArray<unknown>) => {
		viewportCalls(...args);
		return {
			startMs: 1800000,
			endMs: 1800010,
			committedStartMs: 1800000,
			committedEndMs: 1800010,
			wheelHandlers: { ref: { current: null } },
			setViewport: () => {},
		};
	},
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
	beforeEach(() => {
		compute.mockClear();
		viewportCalls.mockClear();
	});

	it("uses the finest native sample interval while retaining each clip's analysis rate", () => {
		const low = createDefaultSource(0, { id: "low" });
		const high = createDefaultSource(1, { id: "high" });
		renderToStaticMarkup(
			createElement(TimelineView, {
				sources: [low, high],
				sourceAudio: new Map([
					["low", { ...EMPTY_AUDIO_DATA, sampleRate: 44100, durationMs: 3600000, totalSamples: 44100 * 3600 }],
					["high", { ...EMPTY_AUDIO_DATA, sampleRate: 96000, durationMs: 3600000, totalSamples: 96000 * 3600 }],
				]),
				channelInput: "mono",
				settings: INITIAL_VIEW_CONTROL_SETTINGS,
			}),
		);
		expect(viewportCalls).toHaveBeenCalledWith(0, 3600000, false, 1000 / 96000);
		expect(
			compute.mock.calls
				.map(([options]) => options)
				.filter((options) => options.config?.spectrogram !== false)
				.map((options) => options.metadata.sampleRate),
		).toEqual([44100, 96000]);
	});

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

describe("Timeline track range", () => {
	it("doubles the track stack and lifts it by half a viewport at a half range", () => {
		expect(trackStackStyleOf({ start: 0.5, end: 1 })).toEqual({ height: "200%", top: "-100%" });
		expect(trackStackStyleOf({ start: 0.25, end: 0.75 })).toEqual({ height: "200%", top: "-50%" });
		expect(trackStackStyleOf({ start: 0, end: 1 })).toEqual({ height: "100%", top: "0%" });
	});

	it("counts fully or partly visible tracks", () => {
		expect(visibleTracksOf({ start: 0, end: 1 }, 5)).toEqual({ first: 1, last: 5 });
		expect(visibleTracksOf({ start: 0.3, end: 0.5 }, 5)).toEqual({ first: 2, last: 3 });
		expect(visibleTracksOf({ start: 0.4, end: 0.6 }, 5)).toEqual({ first: 3, last: 3 });
	});

	it("renders the full-range stack beside a track scroll track", () => {
		const source = createDefaultSource(0, { id: "only" });
		const html = renderToStaticMarkup(
			createElement(TimelineView, {
				sources: [source],
				sourceAudio: new Map([["only", { ...EMPTY_AUDIO_DATA, durationMs: 3600000, totalSamples: 172800000 }]]),
				channelInput: "mono",
				settings: INITIAL_VIEW_CONTROL_SETTINGS,
			}),
		);

		expect(html).toContain("height:100%;top:0%");
		expect(html).toContain('aria-label="Track range"');
		expect(html).toContain('aria-valuetext="tracks 1 to 1 of 1"');
	});
});
