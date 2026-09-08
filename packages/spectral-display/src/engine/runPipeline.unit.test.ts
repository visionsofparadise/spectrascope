import { describe, expect, it, vi } from "vitest";
import { WAVEFORM_POINTS_PER_SECOND } from "./loudness";
import { computeSamplesPerPoint, runPipeline, type PipelineOptions } from "./runPipeline";
import { SpectralEngine, type SpectralProcessContext, type SpectralResult } from "./SpectralEngine";

describe("computeSamplesPerPoint", () => {
	it("pins density to 500 pts/sec when loudness is enabled", () => {
		const sampleRate = 48000;

		expect(computeSamplesPerPoint(sampleRate * 10, 800, sampleRate, true)).toBe(
			Math.round(sampleRate / WAVEFORM_POINTS_PER_SECOND),
		);
	});

	it("derives ~2 points per output pixel column when loudness is off", () => {
		expect(computeSamplesPerPoint(96000, 100, 48000, false)).toBe(Math.floor(96000 / (100 * 2)));
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
			device: { limits: { maxComputeWorkgroupStorageSize: 32768 } } as GPUDevice,
			signal: new AbortController().signal,
			spectrogram: true,
			ltas: true,
			fftSize: 2048,
			loudness: false,
			truePeak: false,
		},
	};
}

describe("runPipeline sample boundaries", () => {
	it("returns sample-resolution waveform and unavailable spectra for a 10ms query", async () => {
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
				device: {} as GPUDevice,
				signal: new AbortController().signal,
			},
			onProgress: (fraction) => fractions.push(fraction),
		};

		await runPipeline(options, new ThrowingEngine({} as GPUDevice));

		expect(fractions).toEqual([chunk / sampleCount, (chunk * 2) / sampleCount, (chunk * 3) / sampleCount, 1]);
	});
});
