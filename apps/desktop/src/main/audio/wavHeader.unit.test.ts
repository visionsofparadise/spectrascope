import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseWavHeader } from "./wavReader";
import { buildWavHeader, headerLength } from "./wavHeader";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectrascope-wavheader-test-"));

afterAll(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("buildWavHeader", () => {
	it("emits a 44-byte standard RIFF float header field-by-field", () => {
		const header = buildWavHeader(48000, 2, 4);
		const dataBytes = 4 * 2 * 4;

		expect(header.length).toBe(44);
		expect(headerLength(4, 2)).toBe(44);

		expect(header.toString("ascii", 0, 4)).toBe("RIFF");
		expect(header.readUInt32LE(4)).toBe(36 + dataBytes);
		expect(header.toString("ascii", 8, 12)).toBe("WAVE");
		expect(header.toString("ascii", 12, 16)).toBe("fmt ");
		expect(header.readUInt32LE(16)).toBe(16);
		expect(header.readUInt16LE(20)).toBe(3); // IEEE float
		expect(header.readUInt16LE(22)).toBe(2); // channels
		expect(header.readUInt32LE(24)).toBe(48000);
		expect(header.readUInt32LE(28)).toBe(48000 * 2 * 4); // byte rate
		expect(header.readUInt16LE(32)).toBe(2 * 4); // block align
		expect(header.readUInt16LE(34)).toBe(32); // bits per sample
		expect(header.toString("ascii", 36, 40)).toBe("data");
		expect(header.readUInt32LE(40)).toBe(dataBytes);
	});

	it("emits an RF64 header with ds64 64-bit sizes when data exceeds 4 GiB", () => {
		const channelCount = 2;
		const frameCount = 600_000_000; // 600M frames × 2ch × 4B = 4.8 GB > 4 GiB
		const dataBytes = frameCount * channelCount * 4;

		expect(headerLength(frameCount, channelCount)).toBe(80);

		const header = buildWavHeader(96000, channelCount, frameCount);

		expect(header.length).toBe(80);
		expect(header.toString("ascii", 0, 4)).toBe("RF64");
		expect(header.readUInt32LE(4)).toBe(0xffffffff); // riff size sentinel
		expect(header.toString("ascii", 8, 12)).toBe("WAVE");

		expect(header.toString("ascii", 12, 16)).toBe("ds64");
		expect(header.readUInt32LE(16)).toBe(28); // ds64 body size
		expect(header.readBigUInt64LE(20)).toBe(BigInt(80 - 8 + dataBytes)); // riff size (file size − 8)
		expect(header.readBigUInt64LE(28)).toBe(BigInt(dataBytes)); // data size
		expect(header.readBigUInt64LE(36)).toBe(BigInt(frameCount)); // sample count

		expect(header.toString("ascii", 48, 52)).toBe("fmt ");
		expect(header.readUInt16LE(56)).toBe(3);
		expect(header.readUInt16LE(58)).toBe(channelCount);
		expect(header.readUInt32LE(60)).toBe(96000);

		expect(header.toString("ascii", 72, 76)).toBe("data");
		expect(header.readUInt32LE(76)).toBe(0xffffffff); // data size sentinel
	});

	it("round-trips through parseWavHeader over an emitted header plus a tiny body", async () => {
		const channelCount = 2;
		const frameCount = 4;
		const header = buildWavHeader(44100, channelCount, frameCount);

		const body = Buffer.alloc(frameCount * channelCount * 4);

		[0.5, -0.5, 0.25, -0.25, 1, -1, 0, 0].forEach((value, index) => body.writeFloatLE(value, index * 4));

		const filePath = path.join(tempDir, "roundtrip.wav");

		fs.writeFileSync(filePath, Buffer.concat([header, body]));

		const handle = await fsPromises.open(filePath, "r");

		try {
			const parsed = await parseWavHeader(handle);

			expect(parsed.format).toBe("float");
			expect(parsed.sampleRate).toBe(44100);
			expect(parsed.channelCount).toBe(channelCount);
			expect(parsed.bitsPerSample).toBe(32);
			expect(parsed.dataByteLength).toBe(body.length);
			expect(parsed.frameCount).toBe(frameCount);
		} finally {
			await handle.close();
		}
	});
});
