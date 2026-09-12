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

type RgbColor = readonly [number, number, number];

function toLinear(channel: number): number {
	const normalized = channel / 255;

	return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function toSrgb(channel: number): number {
	return Math.round(255 * (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055));
}

function linearColor(color: RgbColor): RgbColor {
	return [toLinear(color[0]), toLinear(color[1]), toLinear(color[2])];
}

function luminance(color: RgbColor): number {
	return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function mixColors(from: RgbColor, to: RgbColor, fraction: number): RgbColor {
	return [
		from[0] + (to[0] - from[0]) * fraction,
		from[1] + (to[1] - from[1]) * fraction,
		from[2] + (to[2] - from[2]) * fraction,
	];
}

function setLuminance(color: RgbColor, target: number): RgbColor {
	const current = luminance(color);

	return target < current
		? mixColors([0, 0, 0], color, target / current)
		: mixColors(color, [1, 1, 1], (target - current) / (1 - current));
}

function hueOf([red, green, blue]: RgbColor): number {
	const maximum = Math.max(red, green, blue);
	const difference = maximum - Math.min(red, green, blue);

	if (difference === 0) {
		return 0;
	}

	const sector =
		maximum === red
			? (green - blue) / difference
			: maximum === green
				? 2 + (blue - red) / difference
				: 4 + (red - green) / difference;

	return (sector * 60 + 360) % 360;
}

function colorAtHue(hue: number): RgbColor {
	const channel = (offset: number) => 255 * Math.max(0, Math.min(1, Math.abs(((hue / 60 + offset) % 6) - 3) - 1));

	return linearColor([channel(0), channel(4), channel(2)]);
}

export function buildLayerColormap(layer: LayerColor): ColormapDefinition {
	const primary = hexToRgb255(
		/^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(layer.primary) ? layer.primary : NEUTRAL_LAYER_COLOR.primary,
	);
	const primaryLinear = linearColor(primary);
	const primaryLuminance = Math.max(0.25, Math.min(0.7, luminance(primaryLinear)));
	const hue = hueOf(primary);
	const stops = [
		{ index: 0, color: linearColor(VOID_RGB) },
		{ index: 56, color: setLuminance(colorAtHue((hue + 180) % 360), primaryLuminance * 0.08) },
		{ index: 117, color: setLuminance(colorAtHue((hue + 255) % 360), primaryLuminance * 0.35) },
		{ index: 199, color: setLuminance(primaryLinear, primaryLuminance) },
		{ index: 255, color: setLuminance(primaryLinear, 0.94) },
	];
	const colors: Array<{ position: number; color: RgbColor }> = [];
	let previousLuminance = 0;

	for (let index = 0; index < 256; index++) {
		const upperIndex = stops.findIndex((stop) => stop.index >= index);
		const upper = stops[upperIndex];
		const lower = stops[Math.max(0, upperIndex - 1)];

		if (!lower || !upper) {
			continue;
		}

		const fraction = upper.index === lower.index ? 0 : (index - lower.index) / (upper.index - lower.index);
		const linear = mixColors(lower.color, upper.color, fraction);
		let color: RgbColor = [toSrgb(linear[0]), toSrgb(linear[1]), toSrgb(linear[2])];

		while (luminance(linearColor(color)) < previousLuminance) {
			color = [Math.min(255, color[0] + 1), Math.min(255, color[1] + 1), Math.min(255, color[2] + 1)];
		}

		previousLuminance = luminance(linearColor(color));
		colors.push({ position: index / 255, color });
	}

	return { colors };
}
