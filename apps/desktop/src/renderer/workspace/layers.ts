export interface LayerColor {
	readonly primary: string;
	readonly secondary: string;
}

export const DEFAULT_LAYER_PALETTE: ReadonlyArray<LayerColor> = [
	{ primary: "#8CD9CD", secondary: "#0F3D38" },
	{ primary: "#C6B8ED", secondary: "#44355D" },
	{ primary: "#ACC9F5", secondary: "#0B2545" },
	{ primary: "#F4C8A8", secondary: "#7C2D12" },
];

export const NEUTRAL_LAYER_COLOR: LayerColor = {
	primary: "#B8B8C0",
	secondary: "#44444C",
};
