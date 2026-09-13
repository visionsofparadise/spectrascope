import { useEffect, useRef, useState } from "react";
import { getDevice } from "./engine/device";
import { runDisplayPipeline } from "./engine/runDisplayPipeline";
import {
	type PipelineOptions,
	type ResolvedPipelineOptions,
	runPipeline,
	type SampleQuery,
	type SpectralMetadata,
} from "./engine/runPipeline";
import { type Dimensions, type SpectralConfig, SpectralEngine } from "./engine/SpectralEngine";
import { ComputeResultCache } from "./utils/ComputeResultCache";
import { retainTexture } from "./utils/textureOwnership";
import type { LoudnessData } from "./engine/loudness";

export interface SpectralQuery extends Dimensions {
	startMs: number;
	endMs: number;
}

export interface SpectralOptions {
	metadata: SpectralMetadata;
	query: SpectralQuery;
	readSamples: (
		channel: number,
		sampleOffset: number,
		sampleCount: number,
		signal?: AbortSignal,
	) => Promise<Float32Array>;
	config?: Partial<SpectralConfig>;
}

export interface ComputeResultReady {
	waveformEnergyBuffer?: Float64Array;
	spectrogramRange?: { startSample: number; endSample: number };
	status: "ready";
	spectrogramTexture: GPUTexture | null;
	waveformBuffer: Float32Array | null;
	waveformPointCount: number;
	waveformSamplesPerPoint: number;
	loudnessData: LoudnessData | null;
	ltas: Float32Array | null;
	correlationEnvelope: Float32Array | null;
	vectorscopeHistogram: Uint32Array | null;
	options: ResolvedPipelineOptions;
	query: SpectralQuery;
}

export type ComputeResult =
	| { status: "idle" }
	| { status: "error"; error: Error; previous: ComputeResultReady | null }
	| { status: "computing"; fraction: number; previous: ComputeResultReady | null }
	| ComputeResultReady;

const EMPTY_RESULT: ComputeResult = { status: "idle" };

export function useSpectralCompute(options: SpectralOptions): ComputeResult {
	const { metadata, query, readSamples, config } = options;

	const { sampleRate, sampleCount, channelCount } = metadata;
	const { startMs, endMs, width, height } = query;

	const providedDevice = config?.device;
	const providedSignal = config?.signal;

	const engineReference = useRef<SpectralEngine | null>(null);
	const engineDeviceRef = useRef<GPUDevice | null>(null);
	const textureOwnersRef = useRef(new Map<GPUTexture, () => void>());
	const lastReadyRef = useRef<ComputeResultReady | null>(null);
	const cacheRef = useRef(new ComputeResultCache());
	const cacheScopeRef = useRef<{
		device: GPUDevice;
		readSamples: SpectralOptions["readSamples"];
		key: string;
	} | null>(null);

	const [result, setResult] = useState<ComputeResult>(EMPTY_RESULT);

	const configKey = JSON.stringify(config ?? null);
	const channelWeightsKey = JSON.stringify(metadata.channelWeights ?? null);
	const semanticConfigKey = JSON.stringify({ ...config, device: undefined, signal: undefined });

	useEffect(() => {
		const sampleQuery: SampleQuery = {
			...(config?.displayTiles ? { requestedSampleCount: ((endMs - startMs) * sampleRate) / 1000 } : {}),
			startSample: Math.max(0, Math.min(Math.floor((startMs / 1000) * sampleRate), sampleCount)),
			endSample: Math.max(0, Math.min(Math.ceil((endMs / 1000) * sampleRate), sampleCount)),
			width,
			height,
		};

		if (sampleQuery.endSample <= sampleQuery.startSample || width <= 0 || height <= 0 || channelCount <= 0) {
			cacheRef.current.clear();
			cacheScopeRef.current = null;
			lastReadyRef.current = null;
			setResult(EMPTY_RESULT);

			return;
		}

		setResult({ status: "computing", fraction: 0, previous: lastReadyRef.current });

		const controller = new AbortController();

		const signal = controller.signal;

		let settled = false;
		const obsolete = () => settled || signal.aborted;
		let pendingFraction = 0;
		let progressFrame: number | null = null;

		const flushProgress = () => {
			progressFrame = null;

			if (settled || signal.aborted) return;

			setResult({ status: "computing", fraction: pendingFraction, previous: lastReadyRef.current });
		};

		const onProgress = (fraction: number) => {
			pendingFraction = fraction;

			progressFrame ??= requestAnimationFrame(flushProgress);
		};

		const abort = () => controller.abort();

		if (providedSignal?.aborted) {
			controller.abort();
		} else {
			providedSignal?.addEventListener("abort", abort, { once: true });
		}

		void (async () => {
			try {
				if (obsolete()) return;

				const device =
					providedDevice && engineDeviceRef.current === providedDevice
						? providedDevice
						: await getDevice(providedDevice);

				if (obsolete()) return;

				const scopeKey = JSON.stringify([
					sampleRate,
					sampleCount,
					channelCount,
					channelWeightsKey,
					semanticConfigKey,
				]);
				const scope = cacheScopeRef.current;

				if (scope?.device !== device || scope.readSamples !== readSamples || scope.key !== scopeKey) {
					cacheRef.current.clear();
					cacheScopeRef.current = { device, readSamples, key: scopeKey };
				}

				const queryKey = JSON.stringify([startMs, endMs, width, height]);
				const cached = cacheRef.current.get(queryKey);

				if (cached) {
					if (cached.spectrogramTexture && !textureOwnersRef.current.has(cached.spectrogramTexture)) {
						textureOwnersRef.current.set(cached.spectrogramTexture, retainTexture(cached.spectrogramTexture));
					}

					settled = true;
					lastReadyRef.current = cached;
					setResult(cached);

					return;
				}

				const pipelineOptions: PipelineOptions = {
					metadata,
					sampleQuery,
					readSamples,
					config: {
						...config,
						device,
						signal,
					},
					onProgress,
				};

				if (engineReference.current && engineDeviceRef.current !== device) {
					engineReference.current.destroy();
					engineReference.current = null;
				}

				engineReference.current ??= new SpectralEngine(device);
				engineDeviceRef.current = device;

				const pipelineResult = await (config?.displayTiles ? runDisplayPipeline : runPipeline)(
					pipelineOptions,
					engineReference.current,
				);

				if (obsolete()) {
					pipelineResult.spectrogramTexture?.destroy();

					return;
				}

				if (pipelineResult.spectrogramTexture) {
					textureOwnersRef.current.set(
						pipelineResult.spectrogramTexture,
						retainTexture(pipelineResult.spectrogramTexture),
					);
				}

				settled = true;

				const readyResult: ComputeResultReady = {
					status: "ready",
					...pipelineResult,
					query:
						pipelineResult.displayEndSample === undefined
							? { startMs, endMs, width, height }
							: {
									startMs: (pipelineResult.options.sampleQuery.startSample * 1000) / sampleRate,
									endMs: (pipelineResult.displayEndSample * 1000) / sampleRate,
									width: pipelineResult.options.sampleQuery.width,
									height: pipelineResult.options.sampleQuery.height,
								},
				};

				lastReadyRef.current = readyResult;
				cacheRef.current.set(queryKey, readyResult);

				setResult(readyResult);
			} catch (error: unknown) {
				if (settled || signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
					return;
				}

				settled = true;

				setResult({
					status: "error",
					error: error instanceof Error ? error : new Error(String(error)),
					previous: lastReadyRef.current,
				});
			}
		})();

		return () => {
			settled = true;

			if (progressFrame !== null) cancelAnimationFrame(progressFrame);

			controller.abort();
			providedSignal?.removeEventListener("abort", abort);
		};
	}, [
		sampleRate,
		channelCount,
		sampleCount,
		startMs,
		endMs,
		width,
		height,
		providedDevice,
		providedSignal,
		configKey,
		semanticConfigKey,
		channelWeightsKey,
		readSamples,
	]);

	useEffect(() => {
		const retained = result.status === "ready" ? result : result.status === "idle" ? null : result.previous;

		for (const [texture, release] of textureOwnersRef.current) {
			if (texture !== retained?.spectrogramTexture && texture !== lastReadyRef.current?.spectrogramTexture) {
				release();
				textureOwnersRef.current.delete(texture);
			}
		}
	}, [result]);

	useEffect(
		() => () => {
			cacheRef.current.clear();
			engineReference.current?.destroy();
			engineReference.current = null;

			for (const release of textureOwnersRef.current.values()) release();

			textureOwnersRef.current.clear();
			lastReadyRef.current = null;
		},
		[],
	);

	return result;
}
