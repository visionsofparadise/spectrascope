import { describe, expect, it, vi } from "vitest";
import { StripLayout, StripOverlays, StripSourceRender } from "./stripView";
import { FrequencyAxis, DbAxis } from "./Axes";
import { FrequencyMinimap } from "./FrequencyMinimap";
import { GridOverlay } from "./GridOverlay";
import { createDefaultSource } from "../source";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "../viewSettings";
import { EMPTY_AUDIO_DATA } from "../views/viewAudio";
import type { ComponentProps, ReactElement } from "react";

const source = createDefaultSource(0);
const view = {
	chromeAudio: EMPTY_AUDIO_DATA,
	viewport: { startMs: 0, endMs: 1000, wheelHandlers: { ref: vi.fn() } },
	viewSync: { cursor: null, setCursor: vi.fn() },
	frequencyRange: { top: 0.25, bottom: 0.75 },
	frequencyScale: "mel",
	onFrequencyRangeChange: vi.fn(),
	displayed: new Map(),
	cursorFrac: null,
} as unknown as ComponentProps<typeof StripLayout>["view"];

function elements(node: unknown): Array<ReactElement<Record<string, unknown>>> {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object") return [];
	const element = node as ReactElement<Record<string, unknown>>;
	return [element, ...elements(element.props?.children)];
}

describe("strip display modes", () => {
	it("retains amplitude navigation and dB scale without frequency chrome", () => {
		const tree = elements(
			StripLayout({ view, channelInput: "mono", minimapSources: [], children: null, spectrogram: false }),
		);
		expect(tree.some((element) => element.type === FrequencyAxis)).toBe(false);
		expect(tree.find((element) => element.type === DbAxis)?.props.verticalRange).toEqual(view.frequencyRange);
		const minimap = tree.find((element) => element.type === FrequencyMinimap);
		expect(minimap?.props.amplitude).toBe(true);
		expect(minimap?.props.onFrequencyRangeChange).toBe(view.onFrequencyRangeChange);
		const grid = elements(StripOverlays({ view, settings: INITIAL_VIEW_CONTROL_SETTINGS, spectrogram: false }));
		expect(grid.find((element) => element.type === GridOverlay)?.props.mode).toBe("amp");
	});
	it("retains frequency chrome and configured grids by default", () => {
		const tree = elements(StripLayout({ view, channelInput: "mono", minimapSources: [], children: null }));
		expect(tree.some((element) => element.type === FrequencyAxis)).toBe(true);
		expect(tree.find((element) => element.type === FrequencyMinimap)?.props.amplitude).toBe(false);
		const grid = elements(StripOverlays({ view, settings: INITIAL_VIEW_CONTROL_SETTINGS }));
		expect(grid.find((element) => element.type === GridOverlay)?.props.mode).toBe("freq");
	});
	it("passes waveform-only computation and the chosen standard colormap to sources", () => {
		const props = {
			view,
			settings: { ...INITIAL_VIEW_CONTROL_SETTINGS, spectrogramColormap: "viridis" as const },
			source,
			audioData: EMPTY_AUDIO_DATA,
			channelInput: "mono" as const,
		};
		expect(StripSourceRender({ ...props, spectrogram: false }).props).toMatchObject({
			spectrogram: false,
			spectrogramColormap: "viridis",
		});
		expect(StripSourceRender(props).props.spectrogram).toBe(true);
	});
});
