import { useCallback, useMemo, useRef, useState } from "react";
import { SpectrogramCanvas, WaveformCanvas, useSpectralCompute } from "spectral-display";
import { buildLayerColormap } from "./layers";
import { hexToRgb255 } from "./spectral/colorUtil";
import { ComputeProgress } from "./spectral/ComputeProgress";
import { useContainerSize } from "./spectral/useContainerSize";
import { computeWindowTransform } from "./useTimeViewport";
import type { Source } from "./source";
import type { AudioData } from "./spectral/types";
import type { ChannelInput, ColormapDefinition, ComputeResultReady, SpectralOptions } from "spectral-display";

export interface SourceRenderCursorReadout {
	readonly time: string;
	readonly freq: string;
	readonly amp: string;
}

export interface SourceRenderProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
	/**
	 * The view's live (gesture-following) window, mapped onto the held render via
	 * `computeWindowTransform`. Optional — defaults to the committed
	 * `startMs`/`endMs` (identity transform) for views whose live window equals
	 * the compute window (e.g. Timeline this plan).
	 */
	readonly liveStartMs?: number;
	readonly liveEndMs?: number;
	readonly fftSize: number;
	readonly hopOverlap: number;
	/**
	 * Which derived signal feeds the spectrogram FFT — `"mono"` (channel sum),
	 * `"mid"` (`(L+R)/2`), or `"side"` (`(L-R)/2`). A *compute* parameter:
	 * changing it re-runs the spectrogram pipeline (it must therefore be in the
	 * `spectralOptions` `useMemo` config AND its dependency array).
	 */
	readonly channelInput: ChannelInput;
	readonly opacity?: number;
	readonly clipPath?: string;
	/**
	 * Per-layer opacity for the two stacked canvas layers — the waveform drawn
	 * on top and the spectrogram underneath. `0..1`, default `1`. This is the
	 * compositing hook the per-view right-column layer-opacity knobs drive; it
	 * is distinct from the render-level `opacity` above (the Overlay view's
	 * per-render blend opacity). The render has no loudness layer, so there is no
	 * loudness-opacity prop.
	 */
	readonly waveformOpacity?: number;
	readonly spectrogramOpacity?: number;
	readonly onCursorMove?: (readout: SourceRenderCursorReadout) => void;
}

export function SourceRender({
	source,
	audioData,
	startMs,
	endMs,
	liveStartMs,
	liveEndMs,
	fftSize,
	hopOverlap,
	channelInput,
	opacity = 1,
	clipPath,
	waveformOpacity = 1,
	spectrogramOpacity = 1,
	onCursorMove,
}: SourceRenderProps) {
	const displayRef = useRef<HTMLDivElement>(null);
	const { width, height } = useContainerSize(displayRef, { width: 800, height: 400 });

	const colormap = useMemo<ColormapDefinition>(() => buildLayerColormap(source.layerColor), [source.layerColor]);

	const waveformColor = useMemo<[number, number, number]>(
		() => hexToRgb255(source.layerColor.primary, [255, 255, 255]),
		[source.layerColor.primary],
	);

	const handleMouseMove = useCallback(
		(ev: React.MouseEvent<HTMLDivElement>) => {
			if (!onCursorMove || !displayRef.current) return;

			const rect = displayRef.current.getBoundingClientRect();

			if (rect.width <= 0 || rect.height <= 0) return;

			const xFrac = (ev.clientX - rect.left) / rect.width;
			const yFrac = (ev.clientY - rect.top) / rect.height;

			const timeMs = startMs + xFrac * (endMs - startMs);
			const totalSec = timeMs / 1000;
			const mins = Math.floor(totalSec / 60);
			const secs = Math.floor(totalSec % 60);
			const ms = Math.floor((totalSec % 1) * 1000);
			const timeStr = `${mins.toString().padStart(2, "0")}:${secs
				.toString()
				.padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

			const logMin = Math.log10(20);
			const logMax = Math.log10(20000);
			const freqHz = Math.pow(10, logMax - yFrac * (logMax - logMin));
			const freqStr = freqHz >= 1000 ? `${(freqHz / 1000).toFixed(1)} kHz` : `${Math.round(freqHz)} Hz`;

			onCursorMove({ time: timeStr, freq: freqStr, amp: "— dB" });
		},
		[onCursorMove, startMs, endMs],
	);

	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			query: { startMs, endMs, width, height },
			readSamples: audioData.readSamples,
			config: {
				fftSize,
				hopOverlap,
				frequencyScale: "mel",
				colormap,
				channelInput,
				loudness: false,
				truePeak: false,
			},
		}),
		[
			audioData.sampleRate,
			audioData.totalSamples,
			audioData.channels,
			audioData.readSamples,
			startMs,
			endMs,
			width,
			height,
			fftSize,
			hopOverlap,
			channelInput,
			colormap,
		],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	const incoming = computeResult.status === "ready" ? computeResult : null;

	const [held, setHeld] = useState<ComputeResultReady | null>(null);
	const front = held;

	const drawCountRef = useRef(0);
	const backResultRef = useRef<ComputeResultReady | null>(null);

	if (backResultRef.current !== incoming) {
		backResultRef.current = incoming;
		drawCountRef.current = 0;
	}

	const handleBackRendered = useCallback(() => {
		drawCountRef.current += 1;

		if (drawCountRef.current >= 2 && backResultRef.current !== null) {
			setHeld(backResultRef.current);
		}
	}, []);

	const layerKeyCounterRef = useRef(0);
	const layerKeysRef = useRef(new WeakMap<ComputeResultReady, number>());

	const keyForResult = (result: ComputeResultReady): number => {
		let key = layerKeysRef.current.get(result);

		if (key === undefined) {
			key = layerKeyCounterRef.current += 1;
			layerKeysRef.current.set(result, key);
		}

		return key;
	};

	const live = { startMs: liveStartMs ?? startMs, endMs: liveEndMs ?? endMs };

	const layers: Array<{ result: ComputeResultReady; isFront: boolean }> = [];

	if (front !== null) layers.push({ result: front, isFront: true });

	if (incoming !== null && incoming !== held) layers.push({ result: incoming, isFront: false });

	return (
		<div
			ref={displayRef}
			className="absolute inset-0 overflow-hidden bg-void"
			style={{ opacity, clipPath }}
			onMouseMove={handleMouseMove}
		>
			{layers.map(({ result, isFront }) => (
				<div
					key={keyForResult(result)}
					className="absolute inset-0"
					style={
						isFront
							? {
									transform: computeWindowTransform(result.query, live),
									transformOrigin: "left",
								}
							: { visibility: "hidden" }
					}
				>
					<div
						className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full"
						style={{ opacity: spectrogramOpacity }}
					>
						<SpectrogramCanvas computeResult={result} onRendered={isFront ? undefined : handleBackRendered} />
					</div>
					<div
						className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full"
						style={{ opacity: waveformOpacity }}
					>
						<WaveformCanvas
							computeResult={result}
							color={waveformColor}
							onRendered={isFront ? undefined : handleBackRendered}
						/>
					</div>
				</div>
			))}
			{front === null && computeResult.status === "computing" && (
				<ComputeProgress fraction={computeResult.fraction} />
			)}
		</div>
	);
}
