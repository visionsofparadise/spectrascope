/**
 * Shared view-control settings — the one transient settings object the
 * SourceStrip views (Overlay / Slider / Difference / Sum / Timeline) and the
 * Loudness view consume, plus the option constants their control chips list.
 *
 * The mockup presents a single control cluster for the spectral group in the
 * transport's left region, so the display settings live once at the comparison
 * host (owned by `Comparison.tsx`) and flow into every view as a prop — views
 * are pure consumers. Transient like the per-view-local state it replaces: not
 * persisted into `state.json`, not in the undo/redo history.
 */

export type GridMode = "freq" | "amp";

/** The six loudness metrics the Loudness view plots. */
export type LoudnessMetric =
	| "truePeak"
	| "samplePeak"
	| "integrated"
	| "momentary"
	| "shortTerm"
	| "rms";

export interface MetricSpec {
	readonly id: LoudnessMetric;
	readonly label: string;
	/** dB-axis minimum for this metric. Peak/RMS go down to -60; LUFS down to -40. */
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

/**
 * The display-control state shared across the SourceStrip views and Loudness.
 * `gridMode`/`gridOpacity` drive the grid overlay; the three layer opacities
 * drive `SourceStrip`'s canvas compositing (`loudnessOpacity` is unconsumed —
 * `SourceStrip` has no loudness layer); `fftSize`/`hopOverlap` are spectrogram
 * compute parameters; `loudnessMetric` is the Loudness view's active metric.
 */
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

/**
 * Defaults matching the pre-lift per-view local state — grid "freq"/0.3, the
 * historical stub layer opacities 0.8/0.7/0.5, FFT 2048, hop 16, metric
 * "integrated" — so a freshly-opened comparison looks identical to before.
 */
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

/** FFT size and hop-overlap chip options — consolidated from the per-view copies. */
export const FFT_OPTIONS = ["1024", "2048", "4096", "8192", "16384"] as const;
export const HOP_OPTIONS = ["2", "4", "8", "16", "32"] as const;
export const HOP_LABELS = ["1/2", "1/4", "1/8", "1/16", "1/32"] as const;
