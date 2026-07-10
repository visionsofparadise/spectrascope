import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `ffmpegPath.ts` imports the Electron `app` to decide between the dev and the
// packaged binary location. Outside the Electron runtime that import has no
// real `app`, so it is mocked to the dev branch (`isPackaged: false`), which
// makes `getFfmpegPath` return the `ffmpeg-static` path.
vi.mock("electron", () => ({ app: { isPackaged: false } }));

const { RenderManager } = await import("../RenderManager");

const fixturesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const tone440 = path.join(fixturesDirectory, "tone-440.wav");
const tone660 = path.join(fixturesDirectory, "tone-660.wav");
const tone440Copy = path.join(fixturesDirectory, "tone-440-copy.wav");

/**
 * Reads the interleaved float32 PCM samples out of a `pcm_f32le` WAV by walking
 * the RIFF chunk list — robust to the extra `fmt`/`fact` chunks ffmpeg emits for
 * IEEE-float WAVs.
 */
const readFloatSamples = (filePath: string): Float32Array => {
	const buffer = fs.readFileSync(filePath);

	expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
	expect(buffer.toString("ascii", 8, 12)).toBe("WAVE");

	let offset = 12;

	while (offset + 8 <= buffer.length) {
		const chunkId = buffer.toString("ascii", offset, offset + 4);
		const chunkSize = buffer.readUInt32LE(offset + 4);
		const dataStart = offset + 8;

		if (chunkId === "data") {
			const sampleCount = Math.floor(chunkSize / 4);
			const samples = new Float32Array(sampleCount);

			for (let index = 0; index < sampleCount; index++) {
				samples[index] = buffer.readFloatLE(dataStart + index * 4);
			}

			return samples;
		}

		offset = dataStart + chunkSize + (chunkSize % 2);
	}

	throw new Error(`No data chunk found in ${filePath}`);
};

/** Peak absolute sample amplitude — used to distinguish signal from silence. */
const peakAmplitude = (samples: Float32Array): number => {
	let peak = 0;

	for (const sample of samples) {
		const magnitude = Math.abs(sample);

		if (magnitude > peak) peak = magnitude;
	}

	return peak;
};

describe("RenderManager derived renders", () => {
	let userDataPath: string;
	let renderManager: InstanceType<typeof RenderManager>;

	beforeAll(() => {
		userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "spectrascope-render-test-"));
		renderManager = new RenderManager(userDataPath);
	});

	afterAll(() => {
		renderManager.dispose();
		fs.rmSync(userDataPath, { recursive: true, force: true });
	});

	it("sums two distinct tones into a non-silent WAV", async () => {
		const outputPath = await renderManager.render({
			operation: "sum",
			inputs: [
				{ filePath: tone440, offsetMs: 0 },
				{ filePath: tone660, offsetMs: 0 },
			],
			referenceIndex: 0,
		});

		expect(fs.existsSync(outputPath)).toBe(true);

		const samples = readFloatSamples(outputPath);

		expect(samples.length).toBeGreaterThan(0);
		expect(peakAmplitude(samples)).toBeGreaterThan(0.1);
	});

	it("renders a difference of identical audio as near-silence (the null test)", async () => {
		const outputPath = await renderManager.render({
			operation: "difference",
			inputs: [
				{ filePath: tone440, offsetMs: 0 },
				{ filePath: tone440Copy, offsetMs: 0 },
			],
			referenceIndex: 0,
		});

		expect(fs.existsSync(outputPath)).toBe(true);

		const samples = readFloatSamples(outputPath);

		expect(samples.length).toBeGreaterThan(0);
		// Reference minus an identical copy must cancel to digital silence.
		expect(peakAmplitude(samples)).toBeLessThan(1e-4);
	});
});
