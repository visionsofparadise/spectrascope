import { lavaColormap, viridisColormap } from "spectral-display";
import type { ColormapDefinition } from "spectral-display";

function brighten(colormap: ColormapDefinition, gain: number): ColormapDefinition {
	return {
		colors: colormap.colors.map(({ position, color }) => {
			const linear = color.map((channel) => {
				const value = channel / 255;

				return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			});
			const scale = gain / (1 + (gain - 1) * Math.max(...linear));
			const channel = (index: number) => {
				const value = (linear[index] ?? 0) * scale;

				return Math.round(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055));
			};

			return { position, color: [channel(0), channel(1), channel(2)] };
		}),
	};
}

export const SPECTROGRAM_COLORMAPS = {
	lava: brighten(lavaColormap, 1.2),
	viridis: brighten(viridisColormap, 1.1),
};
