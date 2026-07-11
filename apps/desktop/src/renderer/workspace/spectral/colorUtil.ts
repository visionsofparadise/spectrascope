/**
 * `#RRGGBB` / `#RGB` → `[r, g, b]` (0–255 integers). Shared by the view
 * containers that pass a layer color into a `spectral-display` canvas
 * (`WaveformCanvas`'s `color`, `VectorscopeCanvas`'s `tint`, `MinimapDisplay`'s
 * `waveformColor`). Returns a neutral chrome gray when the input is malformed.
 */
export function hexToRgb255(hex: string): [number, number, number] {
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
		return [184, 184, 192];
	}

	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
