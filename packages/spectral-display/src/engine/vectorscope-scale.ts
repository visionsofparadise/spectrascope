export type VectorscopeScale = "linear" | "sqrt" | "log";

export const VECTORSCOPE_SCALES: ReadonlyArray<VectorscopeScale> = ["linear", "sqrt", "log"];

export const VECTORSCOPE_FULL_SCALE_RADIUS = 0.92;

const LOG_FLOOR_AMPLITUDE = 1e-4;
const LOG_RANGE_DB = 60;

export function vectorscopeWarpOf(amplitude: number, scale: VectorscopeScale): number {
	switch (scale) {
		case "linear":
			return amplitude;
		case "sqrt":
			return Math.sqrt(amplitude);
		case "log":
			return vectorscopeLogWarpOf(Math.log10(Math.max(amplitude, LOG_FLOOR_AMPLITUDE)));
	}
}

export function vectorscopeLogWarpOf(log10Amplitude: number): number {
	return Math.max(0, Math.min(1, 1 + (20 * log10Amplitude) / LOG_RANGE_DB));
}

export function vectorscopeAmplitudeOf(radius: number, scale: VectorscopeScale): number {
	switch (scale) {
		case "linear":
			return radius;
		case "sqrt":
			return radius * radius;
		case "log":
			return radius <= 0 ? 0 : 10 ** (((radius - 1) * LOG_RANGE_DB) / 20);
	}
}
