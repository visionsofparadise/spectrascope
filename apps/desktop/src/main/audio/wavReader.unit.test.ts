import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseWavHeader, readFrames } from "./wavReader";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectrascope-wavreader-test-"));

afterAll(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

const writeFixture = (name: string, buffer: Buffer): string => {
	const filePath = path.join(tempDir, name);

	fs.writeFileSync(filePath, buffer);

	return filePath;
};

/** Builds a RIFF chunk: 4-byte id + 4-byte little-endian size + body + a pad byte when the body length is odd. */
const chunk = (id: string, body: Buffer): Buffer => {
	const header = Buffer.alloc(8);

	header.write(id, 0, "ascii");
	header.writeUInt32LE(body.length, 4);

	const padded = body.length % 2 === 1 ? Buffer.concat([body, Buffer.from([0])]) : body;

	return Buffer.concat([header, padded]);
};

const fmtChunk = (audioFormat: number, channelCount: number, sampleRate: number, bitsPerSample: number): Buffer => {
	const body = Buffer.alloc(16);

	body.writeUInt16LE(audioFormat, 0);
	body.writeUInt16LE(channelCount, 2);
	body.writeUInt32LE(sampleRate, 4);
	body.writeUInt32LE((sampleRate * channelCount * bitsPerSample) / 8, 8);
	body.writeUInt16LE((channelCount * bitsPerSample) / 8, 12);
	body.writeUInt16LE(bitsPerSample, 14);

	return body;
};

const riff = (formId: string, chunks: Buffer): Buffer => {
	const head = Buffer.alloc(12);

	head.write(formId, 0, "ascii");
	head.writeUInt32LE(4 + chunks.length, 4);
	head.write("WAVE", 8, "ascii");

	return Buffer.concat([head, chunks]);
};

describe("parseWavHeader + readFrames", () => {
	it("parses a plain int16 stereo WAV and converts samples to f32", async () => {
		const data = Buffer.alloc(8);
		// frame 0: L = 16384 (0.5), R = -16384 (-0.5); frame 1: L = 32767 (~1), R = 0
		data.writeInt16LE(16384, 0);
		data.writeInt16LE(-16384, 2);
		data.writeInt16LE(32767, 4);
		data.writeInt16LE(0, 6);

		const filePath = writeFixture(
			"int16.wav",
			riff("RIFF", Buffer.concat([chunk("fmt ", fmtChunk(1, 2, 48000, 16)), chunk("data", data)])),
		);
		const handle = await fsPromises.open(filePath, "r");

		try {
			const header = await parseWavHeader(handle);

			expect(header.format).toBe("int");
			expect(header.channelCount).toBe(2);
			expect(header.sampleRate).toBe(48000);
			expect(header.bitsPerSample).toBe(16);
			expect(header.frameCount).toBe(2);

			const frames = await readFrames(handle, header, 0, 2);

			expect(Array.from(frames)).toEqual([0.5, -0.5, 32767 / 32768, 0]);
		} finally {
			await handle.close();
		}
	});

	it("parses a plain float32 mono WAV as passthrough samples", async () => {
		const values = [0.25, -0.75, 1];
		const data = Buffer.alloc(values.length * 4);

		values.forEach((value, index) => data.writeFloatLE(value, index * 4));

		const filePath = writeFixture(
			"float32.wav",
			riff("RIFF", Buffer.concat([chunk("fmt ", fmtChunk(3, 1, 44100, 32)), chunk("data", data)])),
		);
		const handle = await fsPromises.open(filePath, "r");

		try {
			const header = await parseWavHeader(handle);

			expect(header.format).toBe("float");
			expect(header.sampleRate).toBe(44100);
			expect(header.frameCount).toBe(3);

			const frames = await readFrames(handle, header, 0, 3);

			expect(Array.from(frames)).toEqual(values);
		} finally {
			await handle.close();
		}
	});

	it("skips an odd-length chunk's pad byte when walking to the data chunk", async () => {
		const data = Buffer.alloc(4);
		data.writeInt16LE(8192, 0);
		data.writeInt16LE(-8192, 2);

		// A 1-byte (odd) ancillary chunk before data forces a pad-byte skip.
		const oddChunk = chunk("junk", Buffer.from([0x7f]));
		const filePath = writeFixture(
			"oddchunk.wav",
			riff("RIFF", Buffer.concat([chunk("fmt ", fmtChunk(1, 1, 48000, 16)), oddChunk, chunk("data", data)])),
		);
		const handle = await fsPromises.open(filePath, "r");

		try {
			const header = await parseWavHeader(handle);

			expect(header.channelCount).toBe(1);
			expect(header.frameCount).toBe(2);

			const frames = await readFrames(handle, header, 0, 2);

			expect(Array.from(frames)).toEqual([0.25, -0.25]);
		} finally {
			await handle.close();
		}
	});

	it("reads the 64-bit data size from ds64 when the 32-bit data size is 0xFFFFFFFF (RF64)", async () => {
		const values = [0.5, -0.5];
		const data = Buffer.alloc(values.length * 4);

		values.forEach((value, index) => data.writeFloatLE(value, index * 4));

		const ds64Body = Buffer.alloc(28);
		ds64Body.writeBigUInt64LE(0n, 0); // riffSize (unused by parser)
		ds64Body.writeBigUInt64LE(BigInt(data.length), 8); // dataSize
		ds64Body.writeBigUInt64LE(BigInt(values.length), 16); // sampleCount
		ds64Body.writeUInt32LE(0, 24); // tableLength

		// data chunk with the 32-bit size sentinel; real size comes from ds64.
		const dataChunk = Buffer.concat([
			Buffer.from("data", "ascii"),
			(() => {
				const size = Buffer.alloc(4);
				size.writeUInt32LE(0xffffffff, 0);
				return size;
			})(),
			data,
		]);

		const head = Buffer.alloc(12);
		head.write("RF64", 0, "ascii");
		head.writeUInt32LE(0xffffffff, 4);
		head.write("WAVE", 8, "ascii");

		const filePath = writeFixture(
			"rf64.wav",
			Buffer.concat([head, chunk("ds64", ds64Body), chunk("fmt ", fmtChunk(3, 1, 96000, 32)), dataChunk]),
		);
		const handle = await fsPromises.open(filePath, "r");

		try {
			const header = await parseWavHeader(handle);

			expect(header.sampleRate).toBe(96000);
			expect(header.dataByteLength).toBe(data.length);
			expect(header.frameCount).toBe(2);

			const frames = await readFrames(handle, header, 0, 2);

			expect(Array.from(frames)).toEqual(values);
		} finally {
			await handle.close();
		}
	});

	it("resolves the SubFormat GUID of a WAVE_FORMAT_EXTENSIBLE fmt chunk", async () => {
		const data = Buffer.alloc(4);
		data.writeInt16LE(16384, 0);
		data.writeInt16LE(-16384, 2);

		const body = Buffer.alloc(40);
		body.writeUInt16LE(0xfffe, 0); // WAVE_FORMAT_EXTENSIBLE
		body.writeUInt16LE(1, 2); // channels
		body.writeUInt32LE(48000, 4); // sampleRate
		body.writeUInt32LE(96000, 8); // byteRate
		body.writeUInt16LE(2, 12); // blockAlign
		body.writeUInt16LE(16, 14); // bitsPerSample
		body.writeUInt16LE(22, 16); // cbSize
		body.writeUInt16LE(16, 18); // validBitsPerSample
		body.writeUInt32LE(0, 20); // channelMask
		body.writeUInt16LE(1, 24); // SubFormat first two bytes = PCM int

		const filePath = writeFixture(
			"extensible.wav",
			riff("RIFF", Buffer.concat([chunk("fmt ", body), chunk("data", data)])),
		);
		const handle = await fsPromises.open(filePath, "r");

		try {
			const header = await parseWavHeader(handle);

			expect(header.format).toBe("int");
			expect(header.bitsPerSample).toBe(16);

			const frames = await readFrames(handle, header, 0, 2);

			expect(Array.from(frames)).toEqual([0.5, -0.5]);
		} finally {
			await handle.close();
		}
	});

	it("reads a mid-file frame range with a single positioned read", async () => {
		const data = Buffer.alloc(8);
		[100, 200, 300, 400].forEach((value, index) => data.writeInt16LE(value, index * 2));

		const filePath = writeFixture(
			"range.wav",
			riff("RIFF", Buffer.concat([chunk("fmt ", fmtChunk(1, 1, 48000, 16)), chunk("data", data)])),
		);
		const handle = await fsPromises.open(filePath, "r");

		try {
			const header = await parseWavHeader(handle);
			const frames = await readFrames(handle, header, 1, 2);

			expect(Array.from(frames)).toEqual([200 / 32768, 300 / 32768]);
		} finally {
			await handle.close();
		}
	});
});
