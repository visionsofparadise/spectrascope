import { afterEach, describe, expect, it, vi } from "vitest";
import { runDisplayPipeline } from "./runDisplayPipeline";
import { selectSpectralWindows } from "./selectSpectralWindows";
import { SpectralEngine, type SpectralProcessContext } from "./SpectralEngine";
import type { PipelineOptions } from "./runPipeline";
import { WaveformTileCache } from "../utils/WaveformTileCache";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function fixture(samples: Float32Array, width = 800): PipelineOptions {
	return {
		metadata: { sampleRate: 48000, sampleCount: samples.length, channelCount: 1 },
		sampleQuery: { startSample: 0, endSample: samples.length, width, height: 100 },
		readSamples: vi.fn(async (_channel, start, count) => samples.slice(start, start + count)),
		config: {
			device: {
				limits: {
					maxComputeWorkgroupStorageSize: 32768,
					maxTextureDimension2D: 8192,
					maxBufferSize: 268435456,
					maxStorageBufferBindingSize: 134217728,
				},
				createTexture: vi.fn(() => ({ destroy: vi.fn() })),
				createCommandEncoder: vi.fn(() => ({ copyTextureToTexture: vi.fn(), finish: vi.fn() })),
				queue: { submit: vi.fn() },
			} as unknown as GPUDevice,
			signal: new AbortController().signal,
			displayTiles: true,
			spectrogram: false,
			loudness: false,
			truePeak: false,
			stereo: false,
			ltas: false,
			fftSize: 128,
			spectrogramSampling: 1,
			hopOverlap: 4,
		},
	};
}

function spectrum() {
	vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 1, COPY_DST: 2, COPY_SRC: 4 });
	const prepare = vi.spyOn(SpectralEngine.prototype, "prepare").mockResolvedValue({} as SpectralProcessContext);
	const submitted: Array<Float32Array> = [];
	vi.spyOn(SpectralEngine.prototype, "submitChunk").mockImplementation((samples, count) => {
		submitted.push(samples.slice(0, count));
	});
	const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
	const finalize = vi.spyOn(SpectralEngine.prototype, "finalize").mockImplementation(async () => {
		const texture = { destroy: vi.fn() };
		textures.push(texture);
		return { spectrogramTexture: texture as unknown as GPUTexture, ltas: null, width: 256, height: 100 };
	});
	const cleanup = vi.spyOn(SpectralEngine.prototype, "cleanupContext").mockImplementation(() => undefined);
	return { prepare, submitted, textures, finalize, cleanup };
}

function directWindows(samples: Float32Array, count: number, frames: number, fftSize: number, hop: number) {
	return Array.from({ length: frames }, (_, frame) => {
		const first = Math.floor((frame * count) / frames);
		const last = Math.floor(((frame + 1) * count) / frames) - fftSize;
		let winner = first;
		let maximum = -Infinity;
		for (let candidate = first; ; candidate = Math.min(last, candidate + hop)) {
			let energy = 0;
			for (let index = candidate; index < candidate + fftSize; index++) energy += (samples[index] ?? 0) ** 2;
			if (energy > maximum) {
				maximum = energy;
				winner = candidate;
			}
			if (candidate === last) break;
		}
		return winner;
	});
}

describe("stable display pipeline", () => {
	it("shares a pending summary scan between waveform and sampled spectrum displays", async () => {
		const options = fixture(new Float32Array(65536).fill(2), 256);
		options.config.hopOverlap = 1;
		spectrum();
		const engine = new SpectralEngine(options.config.device);
		const [waveform, spectral] = await Promise.all([
			runDisplayPipeline(options, engine),
			runDisplayPipeline({ ...options, config: { ...options.config, spectrogram: true } }, engine),
		]);
		expect(vi.mocked(options.readSamples).mock.calls.filter((call) => call[2] === 65536)).toHaveLength(1);
		expect(vi.mocked(options.readSamples).mock.calls.filter((call) => call[2] === 128)).toHaveLength(256);
		expect(spectral.waveformBuffer).toEqual(waveform.waveformBuffer);
		spectral.spectrogramTexture?.destroy();
	});
	it("falls back to bounded fused streaming when exact energy summaries would exceed the point limit", async () => {
		const options = fixture(new Float32Array(524288).fill(2), 256);
		options.config.fftSize = 8;
		options.config.hopOverlap = 16;
		options.config.spectrogram = true;
		spectrum();
		const summaries = vi.spyOn(WaveformTileCache.prototype, "set");
		const result = await runDisplayPipeline(options, new SpectralEngine(options.config.device));
		expect(vi.mocked(options.readSamples).mock.calls.map((call) => call[2])).toEqual([
			131072, 131072, 131072, 131072,
		]);
		expect(summaries).toHaveBeenCalledTimes(1);
		expect(summaries.mock.calls[0]?.[6].length).toBeLessThanOrEqual(262144);
		expect(result.waveformBuffer.every((value) => value === 2)).toBe(true);
		result.spectrogramTexture?.destroy();
	});
	it("reuses overlapping waveform tiles and preserves exact bins during pans", async () => {
		const samples = Float32Array.from({ length: 200000 }, (_, index) => ((index * 17) % 101) - 50);
		const options = fixture(samples);
		options.sampleQuery = { ...options.sampleQuery, startSample: 1000, endSample: 101000 };
		const engine = new SpectralEngine(options.config.device);
		const prepare = vi.spyOn(SpectralEngine.prototype, "prepare");
		const progress: Array<number> = [];
		options.onProgress = (fraction) => progress.push(fraction);
		const first = await runDisplayPipeline(options, engine);
		expect(progress.every((fraction, index) => index === 0 || fraction >= progress[index - 1]!)).toBe(true);
		expect(progress[progress.length - 1]).toBe(1);
		vi.mocked(options.readSamples).mockClear();
		const second = await runDisplayPipeline(
			{ ...options, sampleQuery: { ...options.sampleQuery, startSample: 12000, endSample: 112000 } },
			engine,
		);
		expect(options.readSamples).not.toHaveBeenCalled();
		expect(second.waveformBuffer).toEqual(first.waveformBuffer);
		const third = await runDisplayPipeline(
			{ ...options, sampleQuery: { ...options.sampleQuery, startSample: 20000, endSample: 120000 } },
			engine,
		);
		expect(options.readSamples).toHaveBeenCalledTimes(1);
		const start = third.options.sampleQuery.startSample;
		const end = first.options.sampleQuery.endSample;
		const step = first.waveformSamplesPerPoint;
		const firstOffset = (start - first.options.sampleQuery.startSample) / step;
		expect(third.waveformBuffer.slice(0, ((end - start) / step) * 2)).toEqual(
			first.waveformBuffer.slice(firstOffset * 2),
		);
		expect(prepare).not.toHaveBeenCalled();
	});
	it("assembles coarser waveform tiles from cached finer extrema and energy without reads", async () => {
		const samples = Float32Array.from({ length: 131072 }, (_, index) => ((index * 13) % 19) - 9);
		const options = fixture(samples, 1024);
		const engine = new SpectralEngine(options.config.device);
		const fine = await runDisplayPipeline(options, engine);
		vi.mocked(options.readSamples).mockClear();
		const coarse = await runDisplayPipeline(
			{ ...options, sampleQuery: { ...options.sampleQuery, width: 512 } },
			engine,
		);
		expect(options.readSamples).not.toHaveBeenCalled();
		expect(coarse.waveformSamplesPerPoint).toBe(fine.waveformSamplesPerPoint * 2);
		for (let point = 0; point < coarse.waveformPointCount; point++) {
			expect(coarse.waveformBuffer[point * 2]).toBe(
				Math.min(fine.waveformBuffer[point * 4]!, fine.waveformBuffer[point * 4 + 2]!),
			);
			expect(coarse.waveformBuffer[point * 2 + 1]).toBe(
				Math.max(fine.waveformBuffer[point * 4 + 1]!, fine.waveformBuffer[point * 4 + 3]!),
			);
			expect(coarse.waveformEnergyBuffer?.[point]).toBe(
				fine.waveformEnergyBuffer![point * 2]! + fine.waveformEnergyBuffer![point * 2 + 1]!,
			);
		}
	});
	it("keeps positive-only final bins free from spectral padding zeros", async () => {
		const samples = new Float32Array(100003).fill(2);
		samples[samples.length - 1] = 3;
		const options = fixture(samples);
		const result = await runDisplayPipeline(options, new SpectralEngine(options.config.device));
		expect(result.options.sampleQuery.endSample).toBe(samples.length);
		expect(result.waveformBuffer[result.waveformBuffer.length - 2]).toBe(2);
		expect(result.waveformBuffer[result.waveformBuffer.length - 1]).toBe(3);
		expect(result.waveformBuffer.every((value) => value >= 2)).toBe(true);
		const finalSamples = samples.length % result.waveformSamplesPerPoint;
		expect(result.waveformEnergyBuffer?.[result.waveformPointCount - 1]).toBe((finalSamples - 1) * 4 + 9);
	});
	it.each([4, 3])(
		"uses cached energy for exact RMS windows at overlap %i without repeating the tile scan",
		async (overlap) => {
			const samples = Float32Array.from({ length: 131072 }, (_, index) => ((index * index + index * 13) % 37) - 18);
			const options = fixture(samples, 256);
			options.config.spectrogram = true;
			options.config.hopOverlap = overlap;
			const gpu = spectrum();
			const engine = new SpectralEngine(options.config.device);
			const initial = await runDisplayPipeline(options, engine);
			initial.spectrogramTexture?.destroy();
			vi.mocked(options.readSamples).mockClear();
			gpu.submitted.length = 0;
			const second = await runDisplayPipeline(
				{ ...options, config: { ...options.config, colormap: "viridis" } },
				engine,
			);
			const starts = directWindows(samples, samples.length, 256, 128, Math.floor(128 / overlap));
			expect(vi.mocked(options.readSamples).mock.calls.map((call) => [call[1], call[2]])).toEqual(
				starts.map((start) => [start, 128]),
			);
			expect(gpu.submitted).toEqual(starts.map((start) => samples.slice(start, start + 128)));
			expect(second.waveformBuffer).toEqual(initial.waveformBuffer);
			second.spectrogramTexture?.destroy();
		},
	);
	it("pads only the full-spectrum input through a nominal final tile", async () => {
		const samples = new Float32Array(10003).fill(2);
		samples[samples.length - 1] = 3;
		const options = fixture(samples, 256);
		options.config.spectrogram = true;
		options.config.spectrogramSampling = "full";
		const gpu = spectrum();
		const result = await runDisplayPipeline(options, new SpectralEngine(options.config.device));
		const submitted = Float32Array.from(gpu.submitted.flatMap((chunk) => [...chunk]));
		expect(submitted.length).toBe(16384);
		expect(submitted.slice(0, samples.length)).toEqual(samples);
		expect(submitted.slice(samples.length).every((value) => value === 0)).toBe(true);
		expect(result.waveformBuffer.every((value) => value >= 2)).toBe(true);
		expect(result.waveformBuffer[result.waveformBuffer.length - 1]).toBe(3);
		result.spectrogramTexture?.destroy();
	});
	it("preserves a cached tile after the acquiring display cancels from progress", async () => {
		const options = fixture(new Float32Array(8192).fill(1), 256);
		options.config.spectrogram = true;
		options.config.fftSize = 8;
		const gpu = spectrum();
		const engine = new SpectralEngine(options.config.device);
		const first = await runDisplayPipeline(options, engine);
		first.spectrogramTexture?.destroy();
		const controller = new AbortController();
		await expect(
			runDisplayPipeline(
				{
					...options,
					config: { ...options.config, signal: controller.signal },
					onProgress: () => controller.abort(),
				},
				engine,
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(gpu.textures[0]?.destroy).not.toHaveBeenCalled();
		vi.mocked(options.readSamples).mockClear();
		const repeated = await runDisplayPipeline(options, engine);
		expect(options.readSamples).not.toHaveBeenCalled();
		expect(gpu.textures[0]?.destroy).not.toHaveBeenCalled();
		repeated.spectrogramTexture?.destroy();
	});
	it("destroys a sampled texture returned after abort without cleaning a finalized context twice", async () => {
		const options = fixture(new Float32Array(8192).fill(1), 256);
		options.config.spectrogram = true;
		options.config.fftSize = 8;
		const controller = new AbortController();
		options.config.signal = controller.signal;
		const gpu = spectrum();
		const destroy = vi.fn();
		gpu.finalize.mockImplementation(async () => {
			controller.abort();
			return { spectrogramTexture: { destroy } as unknown as GPUTexture, ltas: null, width: 256, height: 100 };
		});
		await expect(runDisplayPipeline(options, new SpectralEngine(options.config.device))).rejects.toMatchObject({
			name: "AbortError",
		});
		await vi.waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));
		expect(gpu.cleanup).not.toHaveBeenCalled();
	});
});

describe("cached spectral window energies", () => {
	it.each([1, 2, 4, 8])("matches direct RMS selection at %ix including a partial source tail", (sampling) => {
		const samples = Float32Array.from({ length: 32003 }, (_, index) => ((index * index + index * 7) % 43) - 21);
		const step = 4;
		const energy = new Float64Array(Math.ceil(samples.length / step));
		for (let index = 0; index < samples.length; index++) energy[Math.floor(index / step)]! += samples[index]! ** 2;
		expect(selectSpectralWindows(energy, step, 32768, 256 * sampling, 16, 4)).toEqual(
			directWindows(samples, 32768, 256 * sampling, 16, 4),
		);
	});
});
