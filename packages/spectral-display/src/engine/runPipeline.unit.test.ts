import { describe, expect, it } from "vitest";
import { WAVEFORM_POINTS_PER_SECOND } from "./loudness";
import { computeSamplesPerPoint, runPipeline, type PipelineOptions } from "./runPipeline";
import { SpectralEngine } from "./SpectralEngine";

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
