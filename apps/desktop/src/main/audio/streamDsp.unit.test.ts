import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { renderRange, resolveStream, type ResolvedStream, type StreamSpec } from "./streamDsp";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectrascope-streamdsp-test-"));

afterAll(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

const fmtChunk = (channelCount: number, sampleRate: number): Buffer => {
	const body = Buffer.alloc(16);

	body.writeUInt16LE(3, 0); // IEEE float
	body.writeUInt16LE(channelCount, 2);
	body.writeUInt32LE(sampleRate, 4);
	body.writeUInt32LE(sampleRate * channelCount * 4, 8);
	body.writeUInt16LE(channelCount * 4, 12);
	body.writeUInt16LE(32, 14);

	return body;
};

const chunk = (id: string, body: Buffer): Buffer => {
	const header = Buffer.alloc(8);

	header.write(id, 0, "ascii");
	header.writeUInt32LE(body.length, 4);

	return Buffer.concat([header, body]);
};

/** Writes an interleaved float32 WAV fixture and returns its path. */
const writeFloatWav = (name: string, channelCount: number, sampleRate: number, interleaved: ReadonlyArray<number>): string => {
	const data = Buffer.alloc(interleaved.length * 4);

	interleaved.forEach((value, index) => data.writeFloatLE(value, index * 4));

	const head = Buffer.alloc(12);
	head.write("RIFF", 0, "ascii");
	head.writeUInt32LE(4 + chunk("fmt ", fmtChunk(channelCount, sampleRate)).length + chunk("data", data).length, 4);
	head.write("WAVE", 8, "ascii");

	const filePath = path.join(tempDir, name);

	fs.writeFileSync(filePath, Buffer.concat([head, chunk("fmt ", fmtChunk(channelCount, sampleRate)), chunk("data", data)]));

	return filePath;
};

const openHandle = (pcmPath: string): Promise<fsPromises.FileHandle> => fsPromises.open(pcmPath, "r");

const closeStream = async (resolved: ResolvedStream): Promise<void> => {
	await Promise.all(resolved.inputs.map((input) => input.fileHandle.close()));
};

const withStream = async (spec: StreamSpec, body: (resolved: ResolvedStream) => Promise<void>): Promise<void> => {
	const resolved = await resolveStream(spec, openHandle);

	try {
		await body(resolved);
	} finally {
		await closeStream(resolved);
	}
};

describe("streamDsp", () => {
	it("sums two mono inputs at different offsets, folding each into both stereo channels", async () => {
		// 1000 Hz sample rate → offsetMs 1 = exactly one frame.
		const a = writeFloatWav("sum-a.wav", 1, 1000, [1, 2, 3]);
		const b = writeFloatWav("sum-b.wav", 1, 1000, [10, 20]);

		await withStream({ inputs: [{ pcmPath: a, offsetMs: 0, gain: 1 }, { pcmPath: b, offsetMs: 1, gain: 1 }] }, async (resolved) => {
			expect(resolved.outputChannels).toBe(2);
			expect(resolved.totalFrames).toBe(3);

			const rendered = await renderRange(resolved, 0, 3);

			// frame0: a=1; frame1: a=2 + b=10 = 12; frame2: a=3 + b=20 = 23 — mono duplicated to L and R.
			expect(Array.from(rendered)).toEqual([1, 1, 12, 12, 23, 23]);
		});
	});

	it("nulls an identical pair to exact zeros under gain -1", async () => {
		const a = writeFloatWav("null-a.wav", 1, 1000, [0.5, -0.5, 0.25]);
		const b = writeFloatWav("null-b.wav", 1, 1000, [0.5, -0.5, 0.25]);

		await withStream({ inputs: [{ pcmPath: a, offsetMs: 0, gain: 1 }, { pcmPath: b, offsetMs: 0, gain: -1 }] }, async (resolved) => {
			const rendered = await renderRange(resolved, 0, 3);

			expect(Array.from(rendered)).toEqual([0, 0, 0, 0, 0, 0]);
		});
	});

	it("zero-fills frames before and after a single input's placed extent", async () => {
		const a = writeFloatWav("offset.wav", 1, 1000, [7, 8]);

		await withStream({ inputs: [{ pcmPath: a, offsetMs: 2, gain: 1 }] }, async (resolved) => {
			expect(resolved.outputChannels).toBe(1);
			expect(resolved.totalFrames).toBe(4);

			const rendered = await renderRange(resolved, 0, 6);

			expect(Array.from(rendered)).toEqual([0, 0, 7, 8, 0, 0]);
		});
	});

	it("mixes a mono and a stereo input, folding mono into both channels", async () => {
		const mono = writeFloatWav("mix-mono.wav", 1, 1000, [1]);
		const stereo = writeFloatWav("mix-stereo.wav", 2, 1000, [2, 3]);

		await withStream({ inputs: [{ pcmPath: mono, offsetMs: 0, gain: 1 }, { pcmPath: stereo, offsetMs: 0, gain: 1 }] }, async (resolved) => {
			expect(resolved.outputChannels).toBe(2);

			const rendered = await renderRange(resolved, 0, 1);

			// mono 1 → L=1,R=1; stereo → L=2,R=3; sum L=3,R=4.
			expect(Array.from(rendered)).toEqual([3, 4]);
		});
	});

	it("keeps a single mono input at one channel with no fold", async () => {
		const a = writeFloatWav("single-mono.wav", 1, 1000, [0.5, -0.5]);

		await withStream({ inputs: [{ pcmPath: a, offsetMs: 0, gain: 1 }] }, async (resolved) => {
			expect(resolved.outputChannels).toBe(1);

			const rendered = await renderRange(resolved, 0, 2);

			expect(Array.from(rendered)).toEqual([0.5, -0.5]);
		});
	});
});
