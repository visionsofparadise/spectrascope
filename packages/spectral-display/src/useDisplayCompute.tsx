import { useEffect, useRef, useState } from "react";
import { getDevice } from "./engine/device";
import { DisplayTileStore } from "./engine/DisplayTileStore";
import { resolveRenderDimensions } from "./utils/resolveRenderDimensions";
import { retainTexture } from "./utils/textureOwnership";
import type { PipelineResult } from "./engine/runPipeline";
import type { ComputeResultReady, SpectralOptions } from "./useSpectralCompute";

export interface DisplayComputeTile {
	readonly key: string;
	readonly waveform: ComputeResultReady | null;
	readonly spectrogram: ComputeResultReady | null;
}

export interface DisplayComputeResult {
	readonly status: "idle" | "computing" | "ready" | "error";
	readonly fraction: number;
	readonly tiles: ReadonlyArray<DisplayComputeTile>;
	readonly error?: Error;
}

const EMPTY: DisplayComputeResult = { status: "idle", fraction: 0, tiles: [] };

export function useDisplayCompute(options: SpectralOptions): DisplayComputeResult {
	const [result, setResult] = useState<DisplayComputeResult>(EMPTY);
	const storeRef = useRef<DisplayTileStore | null>(null);
	const deviceRef = useRef<GPUDevice | null>(null);
	const unsubscribeRef = useRef<(() => void) | null>(null);
	const frameRef = useRef<number | null>(null);
	const pendingRef = useRef<DisplayComputeResult>(EMPTY);
	const convertedRef = useRef(new WeakMap<PipelineResult, ComputeResultReady>());
	const ownersRef = useRef(new Map<GPUTexture, () => void>());
	const signalRef = useRef(new AbortController().signal);
	const heightRef = useRef<number | null>(null);
	const { metadata, query, readSamples, config } = options;
	const { sampleRate, sampleCount, channelCount } = metadata;
	const { startMs, endMs, width, height } = query;
	const configKey = JSON.stringify(config ?? null);
	const weightsKey = JSON.stringify(metadata.channelWeights ?? null);
	const providedDevice = config?.device;
	const providedSignal = config?.signal;

	useEffect(() => {
		let obsolete = false;
		const convert = (value: PipelineResult | null): ComputeResultReady | null => {
			if (!value) return null;

			let ready = convertedRef.current.get(value);

			if (!ready) {
				const sampleQuery =
					!value.spectrogramTexture && deviceRef.current && heightRef.current !== null
						? {
								...value.options.sampleQuery,
								height: resolveRenderDimensions(
									{ width: value.options.sampleQuery.width, height: heightRef.current },
									deviceRef.current,
									value.options.config.fftSize,
								).height,
							}
						: value.options.sampleQuery;
				const rate = value.options.metadata.sampleRate;

				ready = {
					...value,
					options:
						!value.spectrogramTexture && deviceRef.current
							? { ...value.options, sampleQuery, config: { ...value.options.config, device: deviceRef.current } }
							: value.options,
					status: "ready",
					query: {
						startMs: (sampleQuery.startSample * 1000) / rate,
						endMs: ((value.displayEndSample ?? sampleQuery.endSample) * 1000) / rate,
						width: sampleQuery.width,
						height: sampleQuery.height,
					},
				};
				convertedRef.current.set(value, ready);
			}

			const texture = ready.spectrogramTexture;

			if (texture && !ownersRef.current.has(texture)) ownersRef.current.set(texture, retainTexture(texture));

			return ready;
		};
		const publish = () => {
			const snapshot = storeRef.current?.getSnapshot();

			if (!snapshot) return;

			const waveforms = new Set<PipelineResult>();
			const spectrograms = new Set<PipelineResult>();
			const tiles: Array<DisplayComputeTile> = [];
			const available = [...snapshot.retainedTiles, ...snapshot.tiles];

			for (let index = available.length - 1; index >= 0; index--) {
				const tile = available[index]!;
				const waveform = tile.waveform && !waveforms.has(tile.waveform) ? tile.waveform : null;
				const spectrogram = tile.spectrogram && !spectrograms.has(tile.spectrogram) ? tile.spectrogram : null;

				if (waveform) waveforms.add(waveform);

				if (spectrogram) spectrograms.add(spectrogram);

				if (waveform || spectrogram)
					tiles.push({ key: tile.key, waveform: convert(waveform), spectrogram: convert(spectrogram) });
			}

			pendingRef.current = {
				status: snapshot.status,
				fraction: snapshot.progress,
				tiles: tiles.reverse(),
				...(snapshot.error ? { error: snapshot.error } : {}),
			};
			frameRef.current ??= requestAnimationFrame(() => {
				frameRef.current = null;
				setResult(pendingRef.current);
			});
		};

		void getDevice(providedDevice)
			.then((device) => {
				if (obsolete) return;

				if (heightRef.current !== height) {
					heightRef.current = height;
					convertedRef.current = new WeakMap();
				}

				if (deviceRef.current !== device || !storeRef.current) {
					unsubscribeRef.current?.();
					storeRef.current?.dispose();
					deviceRef.current = device;
					convertedRef.current = new WeakMap();
					storeRef.current = new DisplayTileStore();
					unsubscribeRef.current = storeRef.current.subscribe(publish);
				}

				storeRef.current.update({
					metadata,
					readSamples,
					sampleQuery: {
						startSample: Math.max(0, Math.min(Math.floor((startMs * sampleRate) / 1000), sampleCount)),
						endSample: Math.max(0, Math.min(Math.ceil((endMs * sampleRate) / 1000), sampleCount)),
						requestedSampleCount: ((endMs - startMs) * sampleRate) / 1000,
						width,
						height,
					},
					config: { ...config, device, signal: providedSignal ?? signalRef.current, displayTiles: true },
				});
				publish();
			})
			.catch((error: unknown) => {
				if (obsolete) return;

				unsubscribeRef.current?.();
				unsubscribeRef.current = null;
				storeRef.current?.dispose();
				storeRef.current = null;

				pendingRef.current = {
					...pendingRef.current,
					status: "error",
					error: error instanceof Error ? error : new Error(String(error)),
				};
				setResult(pendingRef.current);
			});

		return () => {
			obsolete = true;
		};
	}, [
		sampleRate,
		sampleCount,
		channelCount,
		weightsKey,
		startMs,
		endMs,
		width,
		height,
		readSamples,
		configKey,
		providedDevice,
		providedSignal,
	]);

	useEffect(() => {
		const retained = new Set<GPUTexture>();

		for (const snapshot of [result, pendingRef.current])
			for (const tile of snapshot.tiles)
				for (const layer of [tile.waveform, tile.spectrogram])
					if (layer?.spectrogramTexture) retained.add(layer.spectrogramTexture);

		for (const [texture, release] of ownersRef.current)
			if (!retained.has(texture)) {
				release();
				ownersRef.current.delete(texture);
			}
	}, [result]);

	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);

			frameRef.current = null;
			unsubscribeRef.current?.();
			unsubscribeRef.current = null;
			storeRef.current?.dispose();
			storeRef.current = null;

			for (const release of ownersRef.current.values()) release();

			ownersRef.current.clear();
		},
		[],
	);

	return result;
}
