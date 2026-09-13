import { displayTiles } from "../utils/displayTiles";
import { SharedWorkCache, type SharedWorkLease } from "../utils/SharedWorkCache";
import { WaveformTileCache } from "../utils/WaveformTileCache";
import { getMaxFftSize } from "./device";
import { runPipeline, type PipelineOptions, type PipelineResult } from "./runPipeline";
import { createScanContext, scanSamples } from "./sample-scan";
import { selectSpectralWindows } from "./selectSpectralWindows";
import { computeHopSize, resolveConfig, SpectralEngine } from "./SpectralEngine";
import type { DisplayTiles } from "../utils/displayTiles";

const work = new SharedWorkCache<PipelineResult>();
const waveforms = new WaveformTileCache();
const engines = new WeakMap<GPUDevice, SpectralEngine>();
const deviceIds = new WeakMap<GPUDevice, number>();
let nextDeviceId = 0;

function engineOf(device: GPUDevice): SpectralEngine {
	let engine = engines.get(device);

	if (!engine) {
		engine = new SpectralEngine(device);
		engines.set(device, engine);
	}

	return engine;
}

function deviceIdOf(device: GPUDevice): number {
	let id = deviceIds.get(device);

	if (id === undefined) {
		id = nextDeviceId++;
		deviceIds.set(device, id);
	}

	return id;
}

function bytesOf(result: PipelineResult): number {
	return (
		result.waveformBuffer.byteLength +
		(result.waveformEnergyBuffer?.byteLength ?? 0) +
		(result.spectrogramTexture ? result.options.sampleQuery.width * result.options.sampleQuery.height * 4 : 0)
	);
}

async function sampledSpectrum(
	options: PipelineOptions,
	tiles: DisplayTiles,
	energy: Float64Array,
	samplesPerPoint: number,
	frameCount: number,
): Promise<GPUTexture | null> {
	const config = resolveConfig(options.config);
	const fftSize = Math.min(config.fftSize, getMaxFftSize(config.device));
	const starts = selectSpectralWindows(
		energy,
		samplesPerPoint,
		tiles.tileSamples,
		frameCount,
		fftSize,
		Math.max(1, Math.floor(fftSize / config.hopOverlap)),
	);
	const engine = engineOf(config.device);
	const context = await engine.prepare(
		frameCount * fftSize,
		options.metadata.sampleRate,
		{ width: tiles.tileWidth, height: tiles.height },
		{ ...config, hopOverlap: 1 },
	);
	let finalizing = false;

	try {
		const scan = createScanContext(options.metadata, 0, fftSize, fftSize, false, false, false, config.channelInput, {
			pointCount: 0,
			samplesPerPoint: fftSize,
		});

		for (const start of starts) {
			config.signal.throwIfAborted();

			const absoluteStart = options.sampleQuery.startSample + start;
			const count = Math.max(0, Math.min(fftSize, options.metadata.sampleCount - absoluteStart));
			const channels = await Promise.all(
				Array.from({ length: options.metadata.channelCount }, async (_, channel) => {
					const buffer = new Float32Array(fftSize);

					if (count > 0) {
						const samples = await options.readSamples(channel, absoluteStart, count, config.signal);

						if (samples.length !== count) throw new Error("Incomplete spectral window read");

						buffer.set(samples);
					}

					return buffer;
				}),
			);

			config.signal.throwIfAborted();
			scanSamples(channels, fftSize, scan);
			engine.submitChunk(
				config.channelInput === "mono" ? scan.monoBuffer : scan.channelInputBuffer,
				fftSize,
				context,
			);
		}

		finalizing = true;

		const result = await engine.finalize(context, config);

		if (config.signal.aborted) {
			result.spectrogramTexture?.destroy();
			config.signal.throwIfAborted();
		}

		return result.spectrogramTexture;
	} catch (error) {
		if (!finalizing) engine.cleanupContext(context);

		throw error;
	}
}

async function computeTile(options: PipelineOptions, tiles: DisplayTiles, sourceKey: string): Promise<PipelineResult> {
	const config = resolveConfig(options.config);
	const { startSample, endSample } = options.sampleQuery;
	const fftSize = Math.min(config.fftSize, getMaxFftSize(config.device));
	const sampling = config.spectrogramSampling ?? "full";
	const frames = sampling === "full" ? 0 : tiles.tileWidth * sampling;
	const fullFrames =
		Math.floor(
			(tiles.tileSamples - fftSize) / computeHopSize(tiles.tileSamples, tiles.tileWidth, fftSize, config.hopOverlap),
		) + 1;
	const eligible = config.spectrogram && frames > 0 && frames < fullFrames && tiles.tileSamples / frames >= fftSize;
	const hop = Math.max(1, Math.floor(fftSize / config.hopOverlap));
	let energyStep = 2 ** Math.floor(Math.log2(hop));

	while (
		energyStep > 1 &&
		(hop % energyStep !== 0 ||
			fftSize % energyStep !== 0 ||
			(eligible && (tiles.tileSamples / frames) % energyStep !== 0))
	)
		energyStep /= 2;

	const minimumStep = 2 ** Math.max(0, Math.ceil(Math.log2((endSample - startSample) / 262144)));
	const baseStep = Math.max(minimumStep, Math.min(tiles.waveformSamplesPerPoint, 256, eligible ? energyStep : 256));
	const sampled = eligible && energyStep % baseStep === 0;
	let summary = waveforms.get(options.readSamples, sourceKey, startSample, endSample, baseStep);
	let result: PipelineResult | undefined;
	let summaryLease: SharedWorkLease<PipelineResult> | undefined;

	try {
		if (!summary || (config.spectrogram && !sampled)) {
			const scan = (signal: AbortSignal, spectrogram: boolean) =>
				runPipeline(
					{
						...options,
						onProgress: undefined,
						waveformSamplesPerPoint: baseStep,
						spectralEndSample: startSample + tiles.tileSamples,
						config: { ...config, signal, spectrogram },
					},
					engineOf(config.device),
				);

			if (config.spectrogram && !sampled) result = await scan(config.signal, true);
			else {
				summaryLease = await work.run(
					options.readSamples,
					JSON.stringify(["summary", sourceKey, startSample, endSample, baseStep]),
					config.signal,
					(signal) => scan(signal, false),
					bytesOf,
					() => undefined,
				);
				result = summaryLease.value;
			}

			if (!result.waveformEnergyBuffer) throw new Error("Missing waveform energy summary");

			waveforms.set(
				options.readSamples,
				sourceKey,
				startSample,
				endSample,
				baseStep,
				result.waveformBuffer,
				result.waveformEnergyBuffer,
			);
			summary = { ...result, waveformEnergyBuffer: result.waveformEnergyBuffer };
		}

		const texture = sampled
			? await sampledSpectrum(options, tiles, summary.waveformEnergyBuffer, baseStep, frames)
			: (result?.spectrogramTexture ?? null);
		const count = Math.ceil((endSample - startSample) / tiles.waveformSamplesPerPoint);
		const waveformBuffer = new Float32Array(count * 2);
		const waveformEnergyBuffer = new Float64Array(count);
		const ratio = tiles.waveformSamplesPerPoint / baseStep;

		for (let index = 0; index < count; index++) {
			let minimum = Infinity;
			let maximum = -Infinity;
			let energy = 0;

			for (let point = index * ratio; point < Math.min(summary.waveformPointCount, (index + 1) * ratio); point++) {
				minimum = Math.min(minimum, summary.waveformBuffer[point * 2]!);
				maximum = Math.max(maximum, summary.waveformBuffer[point * 2 + 1]!);
				energy += summary.waveformEnergyBuffer[point]!;
			}

			waveformBuffer[index * 2] = minimum;
			waveformBuffer[index * 2 + 1] = maximum;
			waveformEnergyBuffer[index] = energy;
		}

		return {
			waveformBuffer,
			waveformEnergyBuffer,
			waveformPointCount: count,
			waveformSamplesPerPoint: tiles.waveformSamplesPerPoint,
			spectrogramTexture: texture,
			loudnessData: null,
			ltas: null,
			correlationEnvelope: null,
			vectorscopeHistogram: null,
			options: { ...options, config },
		};
	} finally {
		summaryLease?.release();
	}
}

export async function runDisplayPipeline(
	options: PipelineOptions,
	fallbackEngine: SpectralEngine,
): Promise<PipelineResult> {
	const config = resolveConfig(options.config);
	const tiles =
		config.displayTiles && !config.loudness && !config.truePeak && !config.stereo && !config.ltas
			? displayTiles(options.sampleQuery, options.metadata, config.device, config.fftSize)
			: null;

	if (!tiles) return runPipeline(options, fallbackEngine);

	const sourceKey = JSON.stringify([options.metadata, config.channelInput]);
	const spectralKey = JSON.stringify([
		deviceIdOf(config.device),
		config.fftSize,
		config.frequencyScale,
		config.dbRange,
		config.colormap,
		config.hopOverlap,
		config.spectrogramSampling,
		tiles.height,
	]);
	const leases: Array<SharedWorkLease<PipelineResult>> = [];
	let texture: GPUTexture | null = null;

	try {
		for (const startSample of tiles.tileStarts) {
			config.signal.throwIfAborted();

			const endSample = Math.min(options.metadata.sampleCount, startSample + tiles.tileSamples);
			const key = JSON.stringify([
				sourceKey,
				startSample,
				tiles.tileSamples,
				tiles.tileWidth,
				config.spectrogram ? spectralKey : "waveform",
			]);
			const lease = await work.run(
				options.readSamples,
				key,
				config.signal,
				(signal) =>
					computeTile(
						{
							...options,
							onProgress: undefined,
							sampleQuery: { startSample, endSample, width: tiles.tileWidth, height: tiles.height },
							config: { ...config, signal },
						},
						tiles,
						sourceKey,
					),
				bytesOf,
				(result) => result.spectrogramTexture?.destroy(),
			);

			leases.push(lease);
			options.onProgress?.(leases.length / tiles.tileStarts.length);
		}

		config.signal.throwIfAborted();

		const pointCount = Math.ceil((tiles.endSample - tiles.startSample) / tiles.waveformSamplesPerPoint);
		const waveformBuffer = new Float32Array(pointCount * 2);
		const waveformEnergyBuffer = new Float64Array(pointCount);

		if (config.spectrogram)
			texture = config.device.createTexture({
				size: [tiles.width, tiles.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
			});

		const encoder = texture ? config.device.createCommandEncoder() : null;

		for (const [index, lease] of leases.entries()) {
			const result = lease.value;
			const pointOffset = (index * tiles.tileSamples) / tiles.waveformSamplesPerPoint;

			waveformBuffer.set(result.waveformBuffer, pointOffset * 2);

			if (result.waveformEnergyBuffer) waveformEnergyBuffer.set(result.waveformEnergyBuffer, pointOffset);

			if (texture && result.spectrogramTexture)
				encoder?.copyTextureToTexture(
					{ texture: result.spectrogramTexture },
					{ texture, origin: [index * tiles.tileWidth, 0] },
					[tiles.tileWidth, tiles.height],
				);
		}

		if (encoder) config.device.queue.submit([encoder.finish()]);

		return {
			waveformBuffer,
			waveformEnergyBuffer,
			waveformPointCount: pointCount,
			waveformSamplesPerPoint: tiles.waveformSamplesPerPoint,
			loudnessData: null,
			ltas: null,
			correlationEnvelope: null,
			vectorscopeHistogram: null,
			spectrogramTexture: texture,
			displayEndSample: tiles.displayEndSample,
			options: {
				...options,
				config,
				sampleQuery: {
					startSample: tiles.startSample,
					endSample: tiles.endSample,
					width: tiles.width,
					height: tiles.height,
				},
			},
		};
	} catch (error) {
		texture?.destroy();

		throw error;
	} finally {
		for (const lease of leases) lease.release();
	}
}
