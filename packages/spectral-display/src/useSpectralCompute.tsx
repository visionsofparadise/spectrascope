import { useEffect, useRef, useState } from "react";
import { getDevice } from "./engine/device";
import {
	type PipelineOptions,
	type ResolvedPipelineOptions,
	runPipeline,
	type SampleQuery,
	type SpectralMetadata,
} from "./engine/runPipeline";
import { type Dimensions, type SpectralConfig, SpectralEngine } from "./engine/SpectralEngine";
import { retainTexture } from "./utils/textureOwnership";
import type { LoudnessData } from "./engine/loudness";

export interface SpectralQuery extends Dimensions {
	startMs: number;
	endMs: number;
}

export interface SpectralOptions {
	metadata: SpectralMetadata;
	query: SpectralQuery;
	readSamples: (channel: number, sampleOffset: number, sampleCount: number) => Promise<Float32Array>;
	config?: Partial<SpectralConfig>;
}

export interface ComputeResultReady {
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

	const [result, setResult] = useState<ComputeResult>(EMPTY_RESULT);

	const configKey = JSON.stringify(config ?? null);
	const channelWeightsKey = JSON.stringify(metadata.channelWeights ?? null);

	useEffect(() => {
		const sampleQuery: SampleQuery = {
			startSample: Math.max(0, Math.min(Math.floor((startMs / 1000) * sampleRate), sampleCount)),
			endSample: Math.max(0, Math.min(Math.ceil((endMs / 1000) * sampleRate), sampleCount)),
			width,
			height,
		};

		if (sampleQuery.endSample <= sampleQuery.startSample || width <= 0 || height <= 0 || channelCount <= 0) {
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

				const pipelineResult = await runPipeline(pipelineOptions, engineReference.current);

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
					query: { startMs, endMs, width, height },
				};

				lastReadyRef.current = readyResult;

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
