import type { ColormapDefinition } from "spectral-display";

/**
 * A layer's user-assignable color pair.
 *
 * - `primary` is used for waveform stroke, overlay traces (RMS/LUFS/peak), and
 *   layer-scoped cursors.
 * - `secondary` is the spectrogram peak — the layer's spectrogram is a two-point
 *   gradient `void` → `secondary` (magnitude encoded by luminance only).
 *
 * Layer colors are user data, not design tokens. See design-visual-language.md
 * → Color System → Layer Color Model.
 */
export interface LayerColor {
	readonly primary: string;
	readonly secondary: string;
}

/**
 * Seed palette assigned in order as layers are added. Hues spaced to give
 * readable separation across multi-layer comparisons (amber / teal / magenta /
 * sky). The user can override any layer's pair via `LayerColorPicker`.
 */
export const DEFAULT_LAYER_PALETTE: ReadonlyArray<LayerColor> = [
	{ primary: "#F59E0B", secondary: "#7C2D12" },
	{ primary: "#5EC4B6", secondary: "#0F3D38" },
	{ primary: "#EC4899", secondary: "#4A044E" },
	{ primary: "#60A5FA", secondary: "#0B2545" },
];

/** Void background — silence / noise-floor anchor of every layer's gradient. */
const VOID_RGB: readonly [number, number, number] = [2, 2, 4];

function hexToRgb(hex: string): [number, number, number] {
	const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
	const expanded =
		cleaned.length === 3
			? cleaned
					.split("")
					.map((char) => `${char}${char}`)
					.join("")
			: cleaned;
	const value = Number.parseInt(expanded, 16);

	if (Number.isNaN(value) || expanded.length !== 6) {
		return [0, 0, 0];
	}

	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Build the two-point `void` → `secondary` `ColormapDefinition` for a layer.
 * Replaces the retired N-stop perceptual colormaps (Lava/Viridis) — magnitude
 * is encoded by luminance along the ramp; hue is fixed per layer.
 */
export function buildLayerColormap(layer: LayerColor): ColormapDefinition {
	return {
		colors: [
			{ position: 0, color: VOID_RGB },
			{ position: 1, color: hexToRgb(layer.secondary) },
		],
	};
}
