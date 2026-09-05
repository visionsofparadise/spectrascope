
export type GridMode = "freq" | "amp";

export type LoudnessMetric = "truePeak" | "samplePeak" | "integrated" | "momentary" | "shortTerm" | "rms";

export interface MetricSpec {
	readonly id: LoudnessMetric;
	readonly label: string;
	readonly axisMin: number;
}

export const METRICS: ReadonlyArray<MetricSpec> = [
	{ id: "truePeak", label: "True peak", axisMin: -60 },
	{ id: "samplePeak", label: "Sample peak", axisMin: -60 },
	{ id: "integrated", label: "Integrated", axisMin: -40 },
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
}

export const INITIAL_VIEW_CONTROL_SETTINGS: ViewControlSettings = {
	gridMode: "freq",
	gridOpacity: 0.3,
	waveformOpacity: 0.8,
	spectrogramOpacity: 0.7,
	loudnessOpacity: 0.5,
	fftSize: 2048,
	hopOverlap: 16,
	loudnessMetric: "integrated",
};

export const FFT_OPTIONS = ["1024", "2048", "4096", "8192", "16384"] as const;
export const HOP_OPTIONS = ["2", "4", "8", "16", "32"] as const;
export const HOP_LABELS = ["1/2", "1/4", "1/8", "1/16", "1/32"] as const;
