import { hexToRgb255 } from "./spectral/colorUtil";
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

export const NEUTRAL_LAYER_COLOR: LayerColor = {
	primary: "#B8B8C0",
	secondary: "#44444C",
};

export function buildLayerColormap(layer: LayerColor): ColormapDefinition {
	return {
		colors: [
			{ position: 0, color: VOID_RGB },
			{ position: 1, color: hexToRgb255(layer.secondary, [0, 0, 0]) },
		],
	};
}
