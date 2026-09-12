import { describe, expect, it, vi } from "vitest";
import { WAVEFORM_POINTS_PER_SECOND } from "./loudness";
import {
	computeSamplesPerPoint,
	computeWaveformSamplesPerPoint,
	runPipeline,
	type PipelineOptions,
} from "./runPipeline";
import { SpectralEngine, type SpectralProcessContext, type SpectralResult } from "./SpectralEngine";

describe("computeSamplesPerPoint", () => {
	it("pins density to 500 pts/sec when loudness is enabled", () => {
		const sampleRate = 48000;

		expect(computeSamplesPerPoint(sampleRate * 10, 800, sampleRate, true)).toBe(
			Math.round(sampleRate / WAVEFORM_POINTS_PER_SECOND),
		);
	});

	it("keeps existing measurement density while waveform bins use aligned powers of two", () => {
		expect(computeSamplesPerPoint(96000, 100, 48000, false)).toBe(480);
		expect(computeWaveformSamplesPerPoint(96000, 100)).toBe(256);
		expect(computeWaveformSamplesPerPoint(10, 100)).toBe(1);
	});

	it("floors at 1 sample per point when zoomed to sample resolution", () => {
		expect(computeSamplesPerPoint(50, 100, 48000, false)).toBe(1);
	});
});

// Every spectral flag is off, so runPipeline never touches the engine (prepare/submitChunk/
// finalize/cleanupContext are unreachable). Overriding them to throw makes any accidental call
// fail loudly; the `{} as GPUDevice` device cast is the established test pattern from
// SpectralEngine.unit.test.ts.
class ThrowingEngine extends SpectralEngine {
	override async prepare(): Promise<never> {
		throw new Error("prepare should not be called");
	}

	override submitChunk(): never {
		throw new Error("submitChunk should not be called");
	}

	override async finalize(): Promise<never> {
		throw new Error("finalize should not be called");
	}

	override cleanupContext(): never {
		throw new Error("cleanupContext should not be called");
	}
}

function waveformOptions(samples: Float32Array): PipelineOptions {
	return {
		metadata: { sampleRate: 48000, sampleCount: samples.length, channelCount: 1 },
		sampleQuery: { startSample: 0, endSample: samples.length, width: 800, height: 200 },
		readSamples: (_channel, offset, count) => Promise.resolve(samples.slice(offset, offset + count)),
		config: {
			device: {
				limits: {
					maxComputeWorkgroupStorageSize: 32768,
					maxTextureDimension2D: 8192,
					maxBufferSize: 268435456,
					maxStorageBufferBindingSize: 134217728,
				},
			} as GPUDevice,
			signal: new AbortController().signal,
			spectrogram: false,
			ltas: false,
			fftSize: 2048,
			loudness: false,
			truePeak: false,
		},
	};
}

describe("runPipeline sample boundaries", () => {
	it("passes cancellation into a pending sample read", async () => {
		const options = waveformOptions(new Float32Array(480));
		const controller = new AbortController();
		options.config.signal = controller.signal;
		const read = vi.fn(
			(_channel: number, _offset: number, _count: number, signal?: AbortSignal) =>
				new Promise<Float32Array>((_resolve, reject) => {
					signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
		);
		options.readSamples = read;
		const pending = runPipeline(options, new ThrowingEngine(options.config.device));
		expect(read).toHaveBeenCalledWith(0, 0, 480, controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(read).toHaveBeenCalledOnce();
	});

	it("keeps sample waveform detail while loudness retains measurement buckets", async () => {
		const samples = Float32Array.from({ length: 480 }, (_, index) => (index % 2 ? -0.5 : 0.5));
		const options = waveformOptions(samples);
		options.config.loudness = true;
		const result = await runPipeline(options, new ThrowingEngine(options.config.device));
		expect(result.waveformPointCount).toBe(480);
		expect(result.waveformSamplesPerPoint).toBe(1);
		expect(result.waveformBuffer.slice(0, 4)).toEqual(new Float32Array([0.5, 0.5, -0.5, -0.5]));
		expect(result.loudnessData?.pointCount).toBe(5);
	});

	it("returns device-bounded physical dimensions used by waveform density", async () => {
		const options = waveformOptions(new Float32Array(480));
		options.sampleQuery.width = 16384;
		options.sampleQuery.height = 4096;
		const result = await runPipeline(options, new ThrowingEngine(options.config.device));
		expect(result.options.sampleQuery).toMatchObject({ width: 8192, height: 2048 });
		expect(options.sampleQuery.width).toBe(16384);
	});
	it("returns sample-resolution waveform without FFT work when spectral outputs are disabled", async () => {
		const samples = new Float32Array(480);
		samples[479] = 1;
		const result = await runPipeline(waveformOptions(samples), new ThrowingEngine({} as GPUDevice));

		expect(result.waveformPointCount).toBe(480);
		expect(result.waveformSamplesPerPoint).toBe(1);
		expect(result.waveformBuffer[959]).toBe(1);
		expect(result.spectrogramTexture).toBeNull();
		expect(result.ltas).toBeNull();
	});

	it("includes the final bucket after multiple read chunks", async () => {
		const samples = new Float32Array(131073);
		samples[131072] = 1;
		const options = waveformOptions(samples);
		options.config.spectrogram = false;
		options.config.ltas = false;
		const result = await runPipeline(options, new ThrowingEngine({} as GPUDevice));

		expect(result.waveformPointCount).toBe(Math.ceil(samples.length / result.waveformSamplesPerPoint));
		expect(result.waveformBuffer[result.waveformPointCount * 2 - 1]).toBe(1);
	});

	it("rejects an aborted final read before publishing progress or data", async () => {
		const options = waveformOptions(new Float32Array(480));
		const controller = new AbortController();
		options.config.signal = controller.signal;
		options.onProgress = vi.fn();
		options.readSamples = async () => {
			controller.abort();
			return new Float32Array(480);
		};

		await expect(runPipeline(options, new ThrowingEngine({} as GPUDevice))).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(options.onProgress).not.toHaveBeenCalled();
	});

	it("rejects truncated reader output instead of producing NaN samples", async () => {
		const options = waveformOptions(new Float32Array(480));
		options.readSamples = async () => new Float32Array(1);

		await expect(runPipeline(options, new ThrowingEngine({} as GPUDevice))).rejects.toThrow("fewer than 480 samples");
	});

	it("cleans a prepared context once when its read aborts", async () => {
		const options = waveformOptions(new Float32Array(2048));
		options.config.spectrogram = true;
		const controller = new AbortController();
		options.config.signal = controller.signal;
		options.readSamples = async () => {
			controller.abort();
			return new Float32Array(2048);
		};
		const engine = new SpectralEngine(options.config.device);
		const context = {} as SpectralProcessContext;
		vi.spyOn(engine, "prepare").mockResolvedValue(context);
		const cleanup = vi.spyOn(engine, "cleanupContext").mockImplementation(() => undefined);
		const submit = vi.spyOn(engine, "submitChunk");

		await expect(runPipeline(options, engine)).rejects.toMatchObject({ name: "AbortError" });
		expect(cleanup).toHaveBeenCalledExactlyOnceWith(context);
		expect(submit).not.toHaveBeenCalled();
	});

	it("destroys a texture returned after cancellation during GPU readback", async () => {
		const options = waveformOptions(new Float32Array(2048));
		options.config.spectrogram = true;
		const controller = new AbortController();
		options.config.signal = controller.signal;
		const engine = new SpectralEngine(options.config.device);
		vi.spyOn(engine, "prepare").mockResolvedValue({} as SpectralProcessContext);
		vi.spyOn(engine, "submitChunk").mockImplementation(() => undefined);
		let resolveFinalize!: (result: SpectralResult) => void;
		const finalize = vi.spyOn(engine, "finalize").mockReturnValue(
			new Promise((resolve) => {
				resolveFinalize = resolve;
			}),
		);
		const pending = runPipeline(options, engine);
		const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
		await vi.waitFor(() => expect(finalize).toHaveBeenCalledTimes(1));
		controller.abort();
		const destroy = vi.fn();
		resolveFinalize({
			spectrogramTexture: { destroy } as unknown as GPUTexture,
			ltas: null,
			width: 800,
			height: 200,
		});
		await rejected;
		expect(destroy).toHaveBeenCalledTimes(1);
	});
});

describe("contextual FFT at deep zoom", () => {
	function fixture(channels: ReadonlyArray<Float32Array>, start: number, end: number) {
		const options = waveformOptions(channels[0]!);
		options.metadata.channelCount = channels.length;
		options.sampleQuery.startSample = start;
		options.sampleQuery.endSample = end;
		options.config.fftSize = 8;
		options.config.spectrogram = true;
		options.config.ltas = true;
		options.config.loudness = true;
		options.readSamples = vi.fn(async (channel, offset, count) => channels[channel]!.slice(offset, offset + count));
		const engine = new SpectralEngine(options.config.device);
		const context = {} as SpectralProcessContext;
		const prepare = vi.spyOn(engine, "prepare").mockResolvedValue(context);
		const submitted: Array<Float32Array> = [];
		const submit = vi.spyOn(engine, "submitChunk").mockImplementation((samples, count) => {
			submitted.push(samples.slice(0, count));
		});
		const cleanup = vi.spyOn(engine, "cleanupContext").mockImplementation(() => undefined);
		const texture = { destroy: vi.fn() } as unknown as GPUTexture;
		vi.spyOn(engine, "finalize").mockResolvedValue({
			spectrogramTexture: texture,
			ltas: new Float32Array([1]),
			width: 800,
			height: 200,
		});
		return { options, engine, prepare, submit, submitted, context, cleanup, texture };
	}

	it.each([
		["mono", 1],
		["mono", 2],
		["mid", 2],
		["side", 2],
	] as const)("samples %s spectra at %ix without changing visible measurements", async (channelInput, sampling) => {
		const channels = [
			Float32Array.from({ length: 512 }, (_, index) => ((index * 7) % 23) / 23),
			Float32Array.from({ length: 512 }, (_, index) => ((index * 3) % 17) / 17),
		];
		const test = fixture(channels, 0, 512);
		test.options.sampleQuery.width = 4;
		test.options.config.channelInput = channelInput;
		test.options.config.ltas = false;
		test.options.config.stereo = true;
		const baseline = await runPipeline(
			{ ...test.options, config: { ...test.options.config, spectrogram: false } },
			new ThrowingEngine(test.options.config.device),
		);
		test.options.config.spectrogramSampling = sampling;
		const actual = await runPipeline(test.options, test.engine);
		expect(test.prepare).toHaveBeenCalledWith(
			32 * sampling,
			48000,
			{ width: 4, height: 200 },
			expect.objectContaining({ hopOverlap: 1 }),
		);
		expect(test.submitted.reduce((sum, batch) => sum + batch.length, 0)).toBe(32 * sampling);
		expect(actual.waveformBuffer).toEqual(baseline.waveformBuffer);
		expect(actual.loudnessData).toEqual(baseline.loudnessData);
		expect(actual.correlationEnvelope).toEqual(baseline.correlationEnvelope);
		expect(
			actual.vectorscopeHistogram?.every((value, index) => value === baseline.vectorscopeHistogram?.[index]),
		).toBe(true);
		expect(actual.options.sampleQuery).toEqual(test.options.sampleQuery);
		expect(actual.options.config.spectrogramSampling).toBe(sampling);
		expect(actual.options.config.hopOverlap).toBe(4);
	});

	it.each(["full", "ltas", "narrow", "no-reduction"])("retains complete FFT processing for %s", async (mode) => {
		const sampleCount = mode === "narrow" ? 16 : 512;
		const test = fixture([new Float32Array(sampleCount)], 0, sampleCount);
		test.options.sampleQuery.width = 4;
		test.options.config.spectrogramSampling = mode === "full" ? "full" : 2;
		test.options.config.ltas = mode === "ltas";
		if (mode === "no-reduction") {
			test.options.sampleQuery.width = 32;
			test.options.config.hopOverlap = 1;
		}
		await runPipeline(test.options, test.engine);
		expect(test.prepare.mock.calls[0]![0]).toBe(sampleCount);
		expect(test.submitted.reduce((sum, batch) => sum + batch.length, 0)).toBe(sampleCount);
	});

	it("uses the device-clamped FFT size for sampled windows", async () => {
		const test = fixture([new Float32Array(50000)], 0, 50000);
		test.options.sampleQuery.width = 2;
		test.options.config.fftSize = 8192;
		test.options.config.ltas = false;
		test.options.config.loudness = false;
		test.options.config.spectrogramSampling = 2;
		const result = await runPipeline(test.options, test.engine);
		expect(test.prepare.mock.calls[0]![0]).toBe(4 * 4096);
		expect(test.submitted.reduce((sum, batch) => sum + batch.length, 0)).toBe(4 * 4096);
		expect(result.options.config.fftSize).toBe(8192);
	});

	it("releases sampled context when cancellation interrupts its streaming scan", async () => {
		const test = fixture([new Float32Array(512)], 0, 512);
		test.options.sampleQuery.width = 4;
		test.options.config.ltas = false;
		test.options.config.spectrogramSampling = 2;
		const controller = new AbortController();
		test.options.config.signal = controller.signal;
		test.options.onProgress = () => controller.abort();
		await expect(runPipeline(test.options, test.engine)).rejects.toMatchObject({ name: "AbortError" });
		expect(test.cleanup).toHaveBeenCalledOnce();
		expect(test.engine.finalize).not.toHaveBeenCalled();
		expect(test.submitted).toHaveLength(0);
	});

	it.each(["mono", "mid", "side"] as const)(
		"uses bounded %s context while preserving visible statistics",
		async (channelInput) => {
			const channels = [Float32Array.from({ length: 20 }, (_, index) => index), new Float32Array(20).fill(2)];
			const test = fixture(channels, 9, 11);
			test.options.config.channelInput = channelInput;
			const baseline = await runPipeline(
				{ ...test.options, config: { ...test.options.config, spectrogram: false, ltas: false } },
				new ThrowingEngine(test.options.config.device),
			);
			vi.mocked(test.options.readSamples).mockClear();
			const result = await runPipeline(test.options, test.engine);
			expect(test.prepare).toHaveBeenCalledWith(8, 48000, { width: 800, height: 200 }, expect.anything());
			expect(vi.mocked(test.options.readSamples).mock.calls).toEqual([
				[0, 9, 2, test.options.config.signal],
				[1, 9, 2, test.options.config.signal],
				[0, 6, 8, test.options.config.signal],
				[1, 6, 8, test.options.config.signal],
			]);
			expect(test.submitted).toEqual([
				Float32Array.from({ length: 8 }, (_, index) => (6 + index + (channelInput === "side" ? -2 : 2)) / 2),
			]);
			expect(result.waveformBuffer).toEqual(baseline.waveformBuffer);
			expect(result.loudnessData).toEqual(baseline.loudnessData);
			expect(result.options.sampleQuery).toEqual(test.options.sampleQuery);
			expect(result.spectrogramTexture).toBe(test.texture);
			expect(result.ltas).toEqual(new Float32Array([1]));
		},
	);

	it("centers and pads a whole short file without reading outside it", async () => {
		const test = fixture([new Float32Array([1, 2, 3])], 2, 3);
		const result = await runPipeline(test.options, test.engine);
		expect(vi.mocked(test.options.readSamples).mock.calls).toEqual([
			[0, 2, 1, test.options.config.signal],
			[0, 0, 3, test.options.config.signal],
		]);
		expect(test.submitted).toEqual([new Float32Array([0, 0, 0, 1, 2, 3, 0, 0])]);
		expect(result.waveformBuffer).toEqual(new Float32Array([3, 3]));
	});

	it.each(["abort", "truncate"])("cleans prepared resources when supplemental reads %s", async (failure) => {
		const test = fixture([new Float32Array(20)], 9, 11);
		const controller = new AbortController();
		test.options.config.signal = controller.signal;
		test.options.readSamples = async (_channel, _offset, count) => {
			if (count === 8 && failure === "abort") controller.abort();
			return new Float32Array(count === 8 && failure === "truncate" ? 1 : count);
		};
		await expect(runPipeline(test.options, test.engine)).rejects.toThrow();
		expect(test.cleanup).toHaveBeenCalledExactlyOnceWith(test.context);
		expect(test.submit).not.toHaveBeenCalled();
	});
});

describe("shared completed CPU scans", () => {
	it("reuses completed spectral scans in another engine at a different height and coarser width", async () => {
		const samples = Float32Array.from({ length: 65539 }, (_, index) => Math.sin(index * 0.37));
		samples[samples.length - 1] = 3;
		const options = waveformOptions(samples);
		options.config.spectrogram = true;
		options.readSamples = vi.fn(options.readSamples);
		const engine = new SpectralEngine(options.config.device);
		vi.spyOn(engine, "prepare").mockResolvedValue({} as SpectralProcessContext);
		vi.spyOn(engine, "submitChunk").mockImplementation(() => undefined);
		vi.spyOn(engine, "finalize").mockResolvedValue({ spectrogramTexture: null, ltas: null, width: 800, height: 200 });
		const spectral = await runPipeline(options, engine);
		vi.mocked(options.readSamples).mockClear();
		const next = {
			...options,
			sampleQuery: { ...options.sampleQuery, width: 400, height: 700 },
			config: {
				...options.config,
				spectrogram: false,
				fftSize: 1024,
				frequencyScale: "linear" as const,
				colormap: "viridis" as const,
				spectrogramSampling: 1 as const,
			},
		};
		const actual = await runPipeline(next, new ThrowingEngine(options.config.device));
		expect(options.readSamples).not.toHaveBeenCalled();
		const direct = await runPipeline(
			{ ...next, readSamples: async (_channel, offset, count) => samples.slice(offset, offset + count) },
			new ThrowingEngine(options.config.device),
		);
		expect(actual.waveformBuffer).toEqual(direct.waveformBuffer);
		expect(actual.waveformSamplesPerPoint).toBe(spectral.waveformSamplesPerPoint * 2);
		expect(actual.waveformBuffer[actual.waveformBuffer.length - 1]).toBe(3);
		expect(actual.options.sampleQuery).toEqual(next.sampleQuery);
		expect(actual.options.config).toEqual(direct.options.config);
	});

	it("rescans for higher detail and then reuses that completed detail", async () => {
		const options = waveformOptions(new Float32Array(65539));
		options.sampleQuery.width = 100;
		options.readSamples = vi.fn(options.readSamples);
		await runPipeline(options, new ThrowingEngine(options.config.device));
		options.sampleQuery.width = 800;
		await runPipeline(options, new ThrowingEngine(options.config.device));
		expect(options.readSamples).toHaveBeenCalledTimes(2);
		await runPipeline(options, new ThrowingEngine(options.config.device));
		expect(options.readSamples).toHaveBeenCalledTimes(2);
	});

	it("scans missing measurements once and independently reuses exact loudness and stereo results", async () => {
		const samples = Float32Array.from({ length: 8193 }, (_, index) => Math.sin(index / 10) * 0.4);
		const options = waveformOptions(samples);
		options.metadata.channelCount = 2;
		options.readSamples = vi.fn(options.readSamples);
		await runPipeline(options, new ThrowingEngine(options.config.device));
		options.config.loudness = true;
		options.config.truePeak = true;
		options.config.stereo = true;
		const first = await runPipeline(options, new ThrowingEngine(options.config.device));
		expect(options.readSamples).toHaveBeenCalledTimes(4);
		const expected = first.loudnessData!.rmsEnvelope[0];
		first.loudnessData!.rmsEnvelope[0] = 99;
		const next = { ...options, sampleQuery: { ...options.sampleQuery, width: 200, height: 1 } };
		const hit = await runPipeline(next, new ThrowingEngine(options.config.device));
		expect(options.readSamples).toHaveBeenCalledTimes(4);
		expect(hit.loudnessData!.rmsEnvelope[0]).toBe(expected);
		expect(hit.loudnessData!.truePeak).toBe(first.loudnessData!.truePeak);
		expect(hit.correlationEnvelope).toEqual(first.correlationEnvelope);
		expect(hit.vectorscopeHistogram).toEqual(first.vectorscopeHistogram);
		hit.loudnessData!.rmsEnvelope[0] = 88;
		const reduced = await runPipeline(
			{ ...next, config: { ...next.config, truePeak: false, stereo: false } },
			new ThrowingEngine(options.config.device),
		);
		expect(reduced.loudnessData!.rmsEnvelope[0]).toBe(expected);
		expect(reduced.loudnessData!.truePeak).toBeUndefined();
		expect(reduced.loudnessData!.truePeakDb).toBeUndefined();
		expect(reduced.correlationEnvelope).toBeNull();
		expect(reduced.vectorscopeHistogram).toBeNull();
		expect(options.readSamples).toHaveBeenCalledTimes(4);
	});

	it("rejects pre-aborted cache hits and cancellation from hit progress", async () => {
		const options = waveformOptions(new Float32Array(100));
		options.readSamples = vi.fn(options.readSamples);
		await runPipeline(options, new ThrowingEngine(options.config.device));
		const controller = new AbortController();
		controller.abort();
		await expect(
			runPipeline(
				{ ...options, config: { ...options.config, signal: controller.signal } },
				new ThrowingEngine(options.config.device),
			),
		).rejects.toMatchObject({ name: "AbortError" });
		const duringProgress = new AbortController();
		await expect(
			runPipeline(
				{
					...options,
					config: { ...options.config, signal: duringProgress.signal },
					onProgress: () => duringProgress.abort(),
				},
				new ThrowingEngine(options.config.device),
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(options.readSamples).toHaveBeenCalledOnce();
	});

	it.each(["abort", "truncate"])("does not cache a scan whose reader completes with %s", async (failure) => {
		const options = waveformOptions(new Float32Array(100));
		const controller = new AbortController();
		let broken = true;
		options.config.signal = controller.signal;
		options.readSamples = vi.fn(async (_channel, _offset, count) => {
			if (broken && failure === "abort") controller.abort();
			return new Float32Array(broken && failure === "truncate" ? 0 : count);
		});
		await expect(runPipeline(options, new ThrowingEngine(options.config.device))).rejects.toThrow();
		broken = false;
		options.config.signal = new AbortController().signal;
		await runPipeline(options, new ThrowingEngine(options.config.device));
		expect(options.readSamples).toHaveBeenCalledTimes(2);
	});
});

describe("runPipeline onProgress", () => {
	it("emits monotonic per-chunk fractions ending exactly at 1", async () => {
		const chunk = 131072;
		const sampleCount = chunk * 3.5; // 458752 — spans 3.5 chunks
		const fractions: Array<number> = [];

		const options: PipelineOptions = {
			metadata: { sampleRate: 48000, sampleCount, channelCount: 1 },
			sampleQuery: { startSample: 0, endSample: sampleCount, width: 800, height: 200 },
			readSamples: (_channel, _sampleOffset, count) => Promise.resolve(new Float32Array(count)),
			config: {
				spectrogram: false,
				ltas: false,
				loudness: false,
				truePeak: false,
				stereo: false,
				device: waveformOptions(new Float32Array()).config.device,
				signal: new AbortController().signal,
			},
			onProgress: (fraction) => fractions.push(fraction),
		};

		await runPipeline(options, new ThrowingEngine({} as GPUDevice));

		expect(fractions).toEqual([chunk / sampleCount, (chunk * 2) / sampleCount, (chunk * 3) / sampleCount, 1]);
	});
});
