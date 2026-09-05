import type { ColormapDefinition } from "spectral-display";

export interface LayerColor {
	readonly primary: string;
	readonly secondary: string;
}

export const DEFAULT_LAYER_PALETTE: ReadonlyArray<LayerColor> = [
	{ primary: "#F59E0B", secondary: "#7C2D12" },
	{ primary: "#5EC4B6", secondary: "#0F3D38" },
	{ primary: "#EC4899", secondary: "#4A044E" },
	{ primary: "#60A5FA", secondary: "#0B2545" },
];

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

export function buildLayerColormap(layer: LayerColor): ColormapDefinition {
	return {
		colors: [
			{ position: 0, color: VOID_RGB },
			{ position: 1, color: hexToRgb(layer.secondary) },
		],
	};
}
