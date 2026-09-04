import { useEffect, useRef, useState } from "react";
import { type Dimensions, type SpectralConfig, SpectralEngine } from "./engine/SpectralEngine";
import { getDevice } from "./engine/device";
import type { LoudnessData } from "./engine/loudness";
import { type PipelineOptions, type ResolvedPipelineOptions, runPipeline, type SampleQuery, type SpectralMetadata } from "./engine/runPipeline";

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
	loudnessData: LoudnessData | null;
	ltas: Float32Array | null;
	correlationEnvelope: Float32Array | null;
	vectorscopeHistogram: Uint32Array | null;
	options: ResolvedPipelineOptions;
	/** The ms-domain query this result was computed for, echoed verbatim for held-result transforms. */
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

	const deviceReference = useRef<GPUDevice | null>(null);
	const engineReference = useRef<SpectralEngine | null>(null);
	const engineDeviceRef = useRef<GPUDevice | null>(null);
	const previousTextureRef = useRef<GPUTexture | null>(null);
	const lastReadyRef = useRef<ComputeResultReady | null>(null);
	const abortControllerReference = useRef<AbortController | null>(null);
	const readSamplesRef = useRef(readSamples);

	readSamplesRef.current = readSamples;
	const [result, setResult] = useState<ComputeResult>(EMPTY_RESULT);

	const configKey = JSON.stringify(config ?? null);

	useEffect(() => {
		abortControllerReference.current?.abort();

		if (metadata.sampleCount === 0) return;

		setResult({ status: "computing", fraction: 0, previous: lastReadyRef.current });

		const controller = new AbortController();

		abortControllerReference.current = controller;

		const signal = providedSignal ?? controller.signal;

		let settled = false;
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

		if (signal.aborted) {
			controller.abort();
		} else {
			signal.addEventListener("abort", () => controller.abort(), { once: true });
		}

		const sampleQuery: SampleQuery = {
			startSample: Math.floor((startMs / 1000) * sampleRate),
			endSample: Math.min(Math.ceil((endMs / 1000) * sampleRate), sampleCount),
			width,
			height,
		};

		void (async () => {
			try {
				deviceReference.current ??= await getDevice(providedDevice);

				const device = deviceReference.current;

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

				previousTextureRef.current?.destroy();
				previousTextureRef.current = pipelineResult.spectrogramTexture;

				settled = true;

				const readyResult: ComputeResultReady = {
					status: "ready",
					...pipelineResult,
					query: { startMs, endMs, width, height },
				};

				lastReadyRef.current = readyResult;

				setResult(readyResult);
			} catch (error: unknown) {
				if (error instanceof DOMException && error.name === "AbortError") {
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
		};
	}, [sampleRate, channelCount, sampleCount, startMs, endMs, width, height, providedDevice, configKey]);

	useEffect(
		() => () => {
			engineReference.current?.destroy();
			engineReference.current = null;
			previousTextureRef.current?.destroy();
			previousTextureRef.current = null;
		},
		[],
	);

	return result;
}
