export function hexToRgb255(
	hex: string,
	fallback: [number, number, number] = [184, 184, 192],
): [number, number, number] {
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
		return fallback;
	}

	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
