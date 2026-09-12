import { describe, expect, it } from "vitest";
import { generateColormapBuffer } from "../../../../../packages/spectral-display/src/engine/colormap";
import { buildLayerColormap, DEFAULT_LAYER_PALETTE, NEUTRAL_LAYER_COLOR } from "./layers";
import { hexToRgb255 } from "./spectral/colorUtil";

function luminance(color: ReadonlyArray<number>): number {
	const linear = color.map((value) => {
		const channel = value / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

describe("source spectrogram palettes", () => {
	it.each([
		...DEFAULT_LAYER_PALETTE,
		NEUTRAL_LAYER_COLOR,
		...["#000000", "#ffffff", "#888888", "#ff0000", "#00ff00", "#0000ff", "#fff", "#12zzzz"].map((primary) => ({
			primary,
			secondary: "#000000",
		})),
	])("keeps every rounded LUT entry ordered from dark to light for $primary", (layer) => {
		const before = { ...layer };
		const colormap = buildLayerColormap(layer);
		const buffer = generateColormapBuffer(colormap);
		expect(colormap.colors).toHaveLength(256);
		expect([...buffer.slice(0, 4)]).toEqual([2, 2, 4, 255]);
		let previous = 0;
		for (let index = 0; index < 256; index++) {
			const color = [...buffer.slice(index * 4, index * 4 + 3)];
			const current = luminance(color);
			expect(current, `luminance reversed at ${index}`).toBeGreaterThanOrEqual(previous);
			expect(colormap.colors[index]?.position).toBe(index / 255);
			previous = current;
		}
		expect(previous).toBeGreaterThan(0.93);
		expect(layer).toEqual(before);
	});

	it("gives the orange source a blue, purple, orange and cream energy ramp", () => {
		const layer = DEFAULT_LAYER_PALETTE[0]!;
		const { colors } = buildLayerColormap(layer);
		const blue = colors[56]!.color;
		const purple = colors[117]!.color;
		const orange = colors[199]!.color;
		const cream = colors[255]!.color;
		expect(blue[2]).toBeGreaterThan(blue[1]);
		expect(blue[1]).toBeGreaterThan(blue[0]);
		expect(purple[2]).toBeGreaterThan(purple[1]);
		expect(purple[0]).toBeGreaterThan(purple[1]);
		expect(orange).toEqual(hexToRgb255(layer.primary));
		expect(cream[0]).toBeGreaterThan(cream[1]);
		expect(cream[1]).toBeGreaterThan(cream[2]);
		expect(Math.min(...cream)).toBeGreaterThan(230);
	});

	it("retains source identity through distinct ramps independently of the secondary decoration", () => {
		const ramps = DEFAULT_LAYER_PALETTE.map((layer) => buildLayerColormap(layer));
		expect(new Set(ramps.map((ramp) => JSON.stringify(ramp)))).toHaveProperty("size", 4);
		const layer = DEFAULT_LAYER_PALETTE[0]!;
		expect(buildLayerColormap({ ...layer, secondary: "#ffffff" })).toEqual(buildLayerColormap(layer));
	});

	it("falls back deterministically for malformed primary colours", () => {
		for (const primary of ["#12zzzz", "garbage", "#12", "#1234567"]) {
			expect(buildLayerColormap({ primary, secondary: "#000000" })).toEqual(buildLayerColormap(NEUTRAL_LAYER_COLOR));
		}
	});
});
