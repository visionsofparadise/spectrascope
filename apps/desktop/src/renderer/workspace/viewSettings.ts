import { z } from "zod";
import type { FrequencyScale, SpectrogramSampling, VectorscopeScale } from "spectral-display";

export type GridMode = "freq" | "amp";

export type LoudnessMetric = "momentary" | "shortTerm" | "rms";

const LEGACY_SCALAR_METRICS: ReadonlyArray<unknown> = ["integrated", "truePeak", "samplePeak"];

export interface MetricSpec {
	readonly id: LoudnessMetric;
	readonly label: string;
	readonly axisMin: number;
}

export const METRICS: ReadonlyArray<MetricSpec> = [
	{ id: "momentary", label: "Momentary", axisMin: -40 },
	{ id: "shortTerm", label: "Short term", axisMin: -40 },
	{ id: "rms", label: "RMS", axisMin: -60 },
];

export interface ViewControlSettings {
	readonly gridMode: GridMode;
	readonly gridOpacity: number;
	readonly waveformOpacity: number;
	readonly spectrogramOpacity: number;
	readonly loudnessOpacity: number;
	readonly fftSize: number;
	readonly hopOverlap: number;
	readonly loudnessMetric: LoudnessMetric;
	readonly vectorscopeScale: VectorscopeScale;
	readonly frequencyRange: { readonly top: number; readonly bottom: number };
	readonly frequencyScale: FrequencyScale;
	readonly spectrogramSampling: SpectrogramSampling;
	readonly spectrogramColormap: "lava" | "viridis";
}

export const INITIAL_VIEW_CONTROL_SETTINGS: ViewControlSettings = {
	gridMode: "freq",
	gridOpacity: 0.3,
	waveformOpacity: 0.8,
	spectrogramOpacity: 0.7,
	loudnessOpacity: 0.5,
	fftSize: 4096,
	hopOverlap: 16,
	loudnessMetric: "momentary",
	vectorscopeScale: "sqrt",
	frequencyRange: { top: 0, bottom: 1 },
	frequencyScale: "mel",
	spectrogramSampling: 4,
	spectrogramColormap: "lava",
};

export const ViewControlSettingsSchema = z.object({
	spectrogramColormap: z.enum(["lava", "viridis"]).default("lava"),
	spectrogramSampling: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal("full")]).default(4),
	frequencyScale: z.enum(["linear", "log", "mel", "erb"]).default("mel"),
	gridMode: z.enum(["freq", "amp"]).default("freq"),
	gridOpacity: z.number().min(0).max(1).default(0.3),
	waveformOpacity: z.number().min(0).max(1).default(0.8),
	spectrogramOpacity: z.number().min(0).max(1).default(0.7),
	loudnessOpacity: z.number().min(0).max(1).default(0.5),
	fftSize: z
		.number()
		.refine((value) => [1024, 2048, 4096, 8192, 16384].includes(value))
		.default(4096),
	hopOverlap: z
		.number()
		.refine((value) => [2, 4, 8, 16, 32].includes(value))
		.default(16),
	loudnessMetric: z
		.preprocess(
			(value) => (LEGACY_SCALAR_METRICS.includes(value) ? "momentary" : value),
			z.enum(["momentary", "shortTerm", "rms"]),
		)
		.default("momentary"),
	vectorscopeScale: z.enum(["linear", "sqrt", "log"]).default("sqrt"),
	frequencyRange: z
		.object({ top: z.number().min(0).max(1), bottom: z.number().min(0).max(1) })
		.refine(({ top, bottom }) => bottom - top >= 1 / 64 - Number.EPSILON)
		.default({ top: 0, bottom: 1 }),
});

export const FFT_OPTIONS = ["1024", "2048", "4096", "8192", "16384"] as const;
export const HOP_OPTIONS = ["2", "4", "8", "16", "32"] as const;
export const HOP_LABELS = ["1/2", "1/4", "1/8", "1/16", "1/32"] as const;
