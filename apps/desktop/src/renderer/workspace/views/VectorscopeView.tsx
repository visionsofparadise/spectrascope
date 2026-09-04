import { useEffect, useMemo } from "react";
import { useSpectralCompute, VectorscopeCanvas } from "spectral-display";
import { hexToRgb255 } from "../spectral/colorUtil";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { SpectralOptions } from "spectral-display";

/**
 * VectorscopeView — a single shared vectorscope scope with every visible
 * source's `(Side, Mid)` density cloud overlaid on it. Mono (`L = R`) content
 * concentrates on the vertical Mid axis, anti-phase (`L = -R`) on the
 * horizontal Side axis, and pure-L / pure-R content on the ±45° diagonals — the
 * conventional goniometer orientation.
 *
 * Each source's cloud renders as a single-hue cloud in that source's
 * `layerColor.primary` (its `tint`), not a shared colormap. The clouds are
 * z-stacked and composited with `mix-blend-mode: lighten` — the same blend the
 * Overlay view uses — so multiple overlaid clouds stay distinguishable. Each
 * tinted cloud sits on a transparent background (the `VectorscopeCanvas` GPU
 * path outputs premultiplied alpha), so the blend works as intended.
 *
 * The histogram is a real `spectral-display` scan product — computed by
 * `useSpectralCompute` with `config.stereo: true` and rendered on the GPU by
 * `<VectorscopeCanvas>`. The hook is called per-source via the `<SourceCloud>`
 * sub-component (a hook must be called from a render function — one per source).
 *
 * The scope is a whole-clip aggregate with no time evolution, so this view
 * publishes a `disabled: true` `TransportControl` (no transport row), exactly
 * like `FrequencyDistributionView`.
 */

interface VectorscopeViewProps {
	readonly sources: ReadonlyArray<Source>;
	/** Per-source PCM readers, keyed by `Source.id`. */
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

/**
 * Disabled `TransportControl` published by this view. The vectorscope is a
 * whole-clip density aggregate — there is no time axis to scrub, so the
 * transport renders disabled. Replicated from `FrequencyDistributionView`.
 */
const DISABLED_CONTROL: TransportControl = {
	disabled: true,
	playing: false,
	positionSec: 0,
	durationSec: 0,
	onPlayToggle: () => {},
	onSeek: () => {},
};

/**
 * Full-bleed Mid (vertical) / Side (horizontal) crosshair. Drawn across the
 * whole landscape pane — the axis lines extend past the square scope out to the
 * container edges, per the view's design. SVG in a `0 0 1 1` viewBox with
 * `preserveAspectRatio="none"` so the two lines stretch to the pane regardless
 * of aspect ratio.
 */
function FullBleedAxes() {
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 1 1"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			{/* Mid (vertical) axis through the pane centre. */}
			<line
				x1={0.5}
				y1={0}
				x2={0.5}
				y2={1}
				stroke="var(--color-chrome-border)"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
			{/* Side (horizontal) axis through the pane centre. */}
			<line
				x1={0}
				y1={0.5}
				x2={1}
				y2={0.5}
				stroke="var(--color-chrome-border)"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

/**
 * The ±45° L/R reference diagonals. Unlike the crosshair these are scoped to
 * the square scope itself — they are the square's L/R reference geometry, and
 * the corners of the square are where pure-left and pure-right content lands.
 * SVG in a `0 0 1 1` viewBox so it scales with the square.
 */
function ScopeDiagonals() {
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 1 1"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<line
				x1={0}
				y1={0}
				x2={1}
				y2={1}
				stroke="var(--color-chrome-text-dim)"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
			<line
				x1={1}
				y1={0}
				x2={0}
				y2={1}
				stroke="var(--color-chrome-text-dim)"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

/**
 * Sub-component that runs `useSpectralCompute` for one source with the stereo
 * scan products enabled, and renders that source's tinted density cloud,
 * absolutely positioned to fill the shared square scope. The spectrogram /
 * loudness / true-peak pipelines are disabled — only the vectorscope histogram
 * is wanted.
 */
interface SourceCloudProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly onComputeState?: (sourceId: string, state: ComputeState | null) => void;
}

function SourceCloud({ source, audioData, onComputeState }: SourceCloudProps) {
	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			// Width/height are required but the vectorscope histogram is a
			// whole-clip scan product, not a sized render — keep them minimal but
			// non-zero so the engine still runs.
			query: { startMs: 0, endMs: audioData.durationMs, width: 64, height: 64 },
			readSamples: audioData.readSamples,
			config: {
				spectrogram: false,
				loudness: false,
				truePeak: false,
				stereo: true,
			},
		}),
		[audioData.sampleRate, audioData.totalSamples, audioData.channels, audioData.durationMs, audioData.readSamples],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	// The result whose histogram is drawn: the fresh `ready` result, else the
	// last good one held through a recompute or error. Passing `renderable ??
	// computeResult` keeps the held cloud on screen while a recompute runs
	// (`VectorscopeCanvas` only redraws on a `ready` result, so a `computing`
	// pass-through leaves the last drawn cloud untouched).
	const renderable =
		computeResult.status === "ready"
			? computeResult
			: computeResult.status === "computing" || computeResult.status === "error"
				? computeResult.previous
				: null;

	useReportComputeState(source.id, computeResult, onComputeState);

	// The cloud's tint is this source's primary layer color. `VectorscopeCanvas`
	// takes an `[r, g, b]` triple of 0–255 ints (matching `WaveformCanvas`'s
	// `color` prop), so convert the hex through the shared `hexToRgb255` helper.
	const tint = useMemo(() => hexToRgb255(source.layerColor.primary), [source.layerColor.primary]);

	return (
		<div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
			<VectorscopeCanvas computeResult={renderable ?? computeResult} tint={tint} />
		</div>
	);
}

export function VectorscopeView({ sources, sourceAudio, onTransportControlChange }: VectorscopeViewProps) {
	// Visible sources that have decoded audio, paired with their `AudioData`.
	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	// First-compute progress aggregated across the per-source clouds — a shimmer
	// + mean-fraction bar over the scope while any source first-computes.
	const progress = useFirstComputeProgress();

	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(DISABLED_CONTROL);
		}
	}, [onTransportControlChange]);

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-void p-4">
			{renderableSources.length === 0 ? (
				<div className="flex h-full items-center justify-center bg-void">
					<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
				</div>
			) : (
				/* Scope region. The single square scope is the largest square
				   that fits the pane — `100cqmin` resolves to the shorter of the
				   region's two dimensions, so for the landscape Vectorscope pane
				   the square is bounded by the pane height. It is centred
				   horizontally (`justify-center`). The Mid/Side crosshair is
				   full-bleed across this whole region; the ±45° diagonals stay
				   scoped to the square. `containerType: "size"` (not Tailwind's
				   `@container`, which is `inline-size`-only) makes `cqmin`
				   account for both the region's width and its height. */
				<div className="relative flex min-h-0 flex-1 items-center justify-center" style={{ containerType: "size" }}>
					<FullBleedAxes />
					<div
						className="relative aspect-square overflow-hidden"
						style={{ width: "100cqmin", height: "100cqmin" }}
					>
						{/* Z-stacked tinted clouds, blended with `mix-blend-mode:
						    lighten` — the same compositing the Overlay view uses,
						    so multiple overlaid clouds stay distinguishable. */}
						<div className="absolute inset-0" style={{ mixBlendMode: "lighten" }}>
							{renderableSources.map(({ source, audioData }) => (
								<SourceCloud
									key={source.id}
									source={source}
									audioData={audioData}
									onComputeState={progress.handleComputeState}
								/>
							))}
						</div>
						<ScopeDiagonals />
					</div>
					{progress.firstComputing && <ComputeProgress fraction={progress.fraction} />}
				</div>
			)}
		</div>
	);
}
