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

export const NEUTRAL_LAYER_COLOR: LayerColor = {
	primary: "#B8B8C0",
	secondary: "#44444C",
};
