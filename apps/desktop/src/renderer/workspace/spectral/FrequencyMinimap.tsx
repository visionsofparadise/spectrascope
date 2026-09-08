import { useRef, useState, useEffect, useMemo } from "react";
import { SpectrogramCanvas, useSpectralCompute } from "spectral-display";
import { buildLayerColormap } from "../layers";
import { ComputeProgress } from "./ComputeProgress";
import { heldComputeResult } from "./computeResult";
import type { LayerColor } from "../layers";
import type { AudioData } from "./types";
import type { ChannelInput, SpectralOptions } from "spectral-display";

const STRIP_WIDTH = 36;

interface FrequencyMinimapProps {
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
	readonly layerColor: LayerColor;
	readonly channelInput: ChannelInput;
}

export function FrequencyMinimap({ audioData, startMs, endMs, layerColor, channelInput }: FrequencyMinimapProps) {
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
				truePeak: false,
				channelInput,
			},
		}),
		[audioData, startMs, endMs, containerHeight, colormap, channelInput],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	const renderable = heldComputeResult(computeResult);

	return (
		<div ref={containerRef} className="relative w-8 bg-void">
			{renderable !== null && (
				<div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
					<SpectrogramCanvas computeResult={renderable} />
				</div>
			)}
			{computeResult.status === "computing" && computeResult.previous === null && <ComputeProgress />}
			<div
				aria-label="Full frequency range"
				className="pointer-events-none absolute inset-0 border border-data-selection-border"
			/>
		</div>
	);
}
