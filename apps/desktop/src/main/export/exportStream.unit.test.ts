import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveStream, type ResolvedStream } from "../audio/streamDsp";
import { buildWavHeader } from "../audio/wavHeader";
import { parseWavHeader, readFrames } from "../audio/wavReader";
import { resolveExportRange, writeStreamExport } from "./exportStream";

describe("stream exports", () => {
	let directory: string;
	const streams: Array<ResolvedStream> = [];
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-export-"));
	});
	afterEach(async () => {
		for (const stream of streams.splice(0)) for (const input of stream.inputs) await input.fileHandle.close();
		await fs.rm(directory, { recursive: true, force: true });
	});
	async function source(samples: number[], channels = 1, rate = 1000) {
		const filePath = path.join(directory, `input-${streams.length}.wav`);
		const data = Buffer.alloc(samples.length * 4);
		samples.forEach((value, index) => data.writeFloatLE(value, index * 4));
		await fs.writeFile(filePath, Buffer.concat([buildWavHeader(rate, channels, samples.length / channels), data]));
		const stream = await resolveStream({ inputs: [{ pcmPath: filePath, gain: 1, offsetMs: 0 }] }, (file) =>
			fs.open(file, "r"),
		);
		streams.push(stream);
		return stream;
	}
	it("writes only the half-open selected frames and preserves native stereo float samples", async () => {
		const stream = await source([0, 0, 0.25, -0.5, 1.25, -1.5, 0.75, -0.25], 2);
		const target = path.join(directory, "selected.wav");
		await writeStreamExport(target, stream, { kind: "wav", startMs: 1, endMs: 3 });
		const handle = await fs.open(target, "r");
		try {
			const header = await parseWavHeader(handle);
			expect(header.sampleRate).toBe(1000);
			expect(header.channelCount).toBe(2);
			expect(header.frameCount).toBe(2);
			expect([...(await readFrames(handle, header, 0, 2))]).toEqual([0.25, -0.5, 1.25, -1.5]);
		} finally {
			await handle.close();
		}
	});
	it("retains a final partial measurement bin across chunk boundaries", async () => {
		const values = new Array<number>(140003).fill(0.5);
		values[values.length - 1] = -1;
		const stream = await source(values);
		const target = path.join(directory, "measurements.csv");
		await writeStreamExport(target, stream, { kind: "csv", startMs: 2, endMs: values.length });
		const rows = (await fs.readFile(target, "utf8")).trim().split("\n");
		expect(rows.shift()).toBe("start_seconds,end_seconds,channel,min,max,rms");
		expect(rows).toHaveLength(993);
		const first = rows[0]!.split(",").map(Number);
		const last = rows[rows.length - 1]!.split(",").map(Number);
		expect(first).toEqual([0.002, 0.143, 1, 0.5, 0.5, 0.5]);
		expect(last[1]).toBe(140.003);
		expect(last[3]).toBe(-1);
		expect(last[4]).toBe(0.5);
		expect(last[5]).toBeCloseTo(Math.sqrt((128 * 0.25 + 1) / 129));
	});
	it("handles sample fractions at 44.1 kHz and clamps stream bounds", async () => {
		const stream = await source([1, 2, 3], 1, 44100);
		expect(resolveExportRange(stream, { startMs: 1000 / 44100, endMs: 2000 / 44100 })).toEqual({ start: 1, end: 2 });
		expect(resolveExportRange(stream, { startMs: -10, endMs: 1000 })).toEqual({ start: 0, end: 3 });
		expect(() => resolveExportRange(stream, { startMs: 100, endMs: 200 })).toThrow("no audio samples");
		expect(() => resolveExportRange(stream, { endMs: NaN })).toThrow("finite");
	});
	it("preserves the existing destination when CSV measurement fails", async () => {
		const stream = await source([0, NaN]);
		const target = path.join(directory, "saved.csv");
		await fs.writeFile(target, "previous output");
		await expect(writeStreamExport(target, stream, { kind: "csv" })).rejects.toThrow("non-finite");
		expect(await fs.readFile(target, "utf8")).toBe("previous output");
		expect((await fs.readdir(directory)).filter((name) => name.includes(".tmp"))).toEqual([]);
	});
});
