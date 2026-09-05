import { useRef, useState, useEffect, useMemo } from "react";
import { SpectrogramCanvas, useSpectralCompute } from "spectral-display";
import { buildLayerColormap } from "../layers";
import { ComputeProgress } from "./ComputeProgress";
import { heldComputeResult } from "./computeResult";
import type { LayerColor } from "../layers";
import type { AudioData } from "./types";
import type { SpectralOptions } from "spectral-display";

const STRIP_WIDTH = 36;

const VP_TOP_FRAC = 0.18;
const VP_BOTTOM_FRAC = 0.78;

interface FrequencyMinimapProps {
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
	readonly layerColor: LayerColor;
}

export function FrequencyMinimap({ audioData, startMs, endMs, layerColor }: FrequencyMinimapProps) {
	const colormap = useMemo(() => buildLayerColormap(layerColor), [layerColor]);
	const containerRef = useRef<HTMLDivElement>(null);
	const [containerHeight, setContainerHeight] = useState(400);

	useEffect(() => {
		const element = containerRef.current;

		if (!element) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];

			if (!entry) return;

			setContainerHeight(Math.round(entry.contentRect.height));
		});

		observer.observe(element);

		return () => observer.disconnect();
	}, []);

	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			query: { startMs, endMs, width: STRIP_WIDTH, height: containerHeight },
			readSamples: audioData.readSamples,
			config: {
				fftSize: 2048,
				frequencyScale: "mel",
				colormap,
				waveform: false,
				loudness: false,
			},
		}),
		[audioData, startMs, endMs, containerHeight, colormap],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	const renderable = heldComputeResult(computeResult);

	const vpTopPct = VP_TOP_FRAC * 100;
	const vpHeightPct = (VP_BOTTOM_FRAC - VP_TOP_FRAC) * 100;

	return (
		<div ref={containerRef} className="relative w-8 bg-void">
			{renderable !== null && (
				<div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
					<SpectrogramCanvas computeResult={renderable} />
				</div>
			)}
			{computeResult.status === "computing" && computeResult.previous === null && <ComputeProgress />}
			<div className="absolute inset-x-0 top-0 bg-black/65" style={{ height: `${vpTopPct}%` }} />
			<div
				className="absolute inset-x-0 bottom-0 bg-black/65"
				style={{ height: `${(1 - VP_BOTTOM_FRAC) * 100}%` }}
			/>
			<div
				className="absolute inset-x-0 cursor-ns-resize border-2 border-data-selection-border"
				style={{ top: `${vpTopPct}%`, height: `${vpHeightPct}%` }}
			/>
		</div>
	);
}
