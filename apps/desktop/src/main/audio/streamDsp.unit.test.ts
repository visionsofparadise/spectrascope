import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeResolvedStream, renderRange, resolveStream, type ResolvedStream, type StreamSpec } from "./streamDsp";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "spectrascope-streamdsp-test-"));

afterAll(() => {
	fs.rmSync(tempDir, { recursive: true, force: true });
});

const fmtChunk = (channelCount: number, sampleRate: number): Buffer => {
	const body = Buffer.alloc(16);

	body.writeUInt16LE(3, 0);
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

const writeFloatWav = (
	name: string,
	channelCount: number,
	sampleRate: number,
	interleaved: ReadonlyArray<number>,
): string => {
	const data = Buffer.alloc(interleaved.length * 4);

	interleaved.forEach((value, index) => data.writeFloatLE(value, index * 4));

	const head = Buffer.alloc(12);
	head.write("RIFF", 0, "ascii");
	head.writeUInt32LE(4 + chunk("fmt ", fmtChunk(channelCount, sampleRate)).length + chunk("data", data).length, 4);
	head.write("WAVE", 8, "ascii");

	const filePath = path.join(tempDir, name);

	fs.writeFileSync(
		filePath,
		Buffer.concat([head, chunk("fmt ", fmtChunk(channelCount, sampleRate)), chunk("data", data)]),
	);

	return filePath;
};

const openHandle = (pcmPath: string): Promise<fsPromises.FileHandle> => fsPromises.open(pcmPath, "r");

const closeStream = async (resolved: ResolvedStream): Promise<void> => {
	await closeResolvedStream(resolved);
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
	it.each([1, -1] as const)(
		"prepares only lower native rates and renders gain %s at the highest rate",
		async (gain) => {
			const low = writeFloatWav(`low-${gain}.wav`, 1, 24000, [1, 2]);
			const high = writeFloatWav(`high-${gain}.wav`, 1, 48000, [10, 20, 30, 40]);
			const converted = writeFloatWav(`converted-${gain}.wav`, 1, 48000, [1, 1.5, 2, 2]);
			const release = vi.fn();
			const prepare = vi.fn(async () => ({ pcmPath: converted, release }));
			const spec: StreamSpec = {
				inputs: [
					{ pcmPath: low, offsetMs: 1000 / 48000, gain },
					{ pcmPath: high, offsetMs: 0, gain: 1 },
				],
			};
			const resolved = await resolveStream(spec, openHandle, prepare);
			try {
				expect(prepare).toHaveBeenCalledExactlyOnceWith(low, 48000);
				expect(resolved.spec).toBe(spec);
				expect(resolved.sampleRate).toBe(48000);
				expect(resolved.outputChannels).toBe(2);
				expect(resolved.totalFrames).toBe(5);
				expect(resolved.inputs[0]?.pcmPath).toBe(converted);
				expect(resolved.inputs[0]?.offsetFrames).toBe(1);
				expect([...(await renderRange(resolved, 0, 5))]).toEqual([
					10,
					10,
					20 + gain,
					20 + gain,
					30 + gain * 1.5,
					30 + gain * 1.5,
					40 + gain * 2,
					40 + gain * 2,
					gain * 2,
					gain * 2,
				]);
				expect(release).not.toHaveBeenCalled();
			} finally {
				await closeStream(resolved);
			}
			expect(release).toHaveBeenCalledOnce();
			await closeStream(resolved);
			expect(release).toHaveBeenCalledOnce();
		},
	);

	it("keeps individual native streams and already matched streams on their original files", async () => {
		const native = writeFloatWav("native-96000.wav", 2, 96000, [1, 2]);
		const prepare = vi.fn();
		for (const count of [1, 2]) {
			const resolved = await resolveStream(
				{ inputs: Array.from({ length: count }, () => ({ pcmPath: native, offsetMs: 0, gain: 1 as const })) },
				openHandle,
				prepare,
			);
			try {
				expect(resolved.sampleRate).toBe(96000);
				expect(resolved.inputs.every((input) => input.pcmPath === native)).toBe(true);
			} finally {
				await closeStream(resolved);
			}
		}
		expect(prepare).not.toHaveBeenCalled();
	});

	it.each(["rate", "channels", "missing"])(
		"releases prepared ownership and all handles on invalid %s",
		async (failure) => {
			const low = writeFloatWav(`failed-low-${failure}.wav`, 1, 24000, [1]);
			const high = writeFloatWav(`failed-high-${failure}.wav`, 1, 48000, [1, 1]);
			const converted =
				failure === "missing"
					? path.join(tempDir, "missing.wav")
					: writeFloatWav(
							`failed-prepared-${failure}.wav`,
							failure === "channels" ? 2 : 1,
							failure === "rate" ? 24000 : 48000,
							[1, 1],
						);
			const handles: Array<fsPromises.FileHandle> = [];
			const release = vi.fn();
			await expect(
				resolveStream(
					{
						inputs: [
							{ pcmPath: high, offsetMs: 0, gain: 1 },
							{ pcmPath: low, offsetMs: 0, gain: 1 },
						],
					},
					async (pcmPath) => {
						const handle = await openHandle(pcmPath);
						handles.push(handle);
						return handle;
					},
					async () => ({ pcmPath: converted, release }),
				),
			).rejects.toThrow();
			expect(release).toHaveBeenCalledOnce();
			for (const handle of handles) await expect(handle.stat()).rejects.toThrow();
		},
	);

	it("releases an earlier prepared input when a later resample fails", async () => {
		const low = writeFloatWav("multi-low.wav", 1, 24000, [1]);
		const middle = writeFloatWav("multi-middle.wav", 1, 44100, [1]);
		const high = writeFloatWav("multi-high.wav", 1, 48000, [1, 1]);
		const converted = writeFloatWav("multi-converted.wav", 1, 48000, [1, 1]);
		const release = vi.fn();
		const prepare = vi
			.fn()
			.mockResolvedValueOnce({ pcmPath: converted, release })
			.mockRejectedValueOnce(new Error("Resample failed"));
		await expect(
			resolveStream(
				{ inputs: [low, middle, high].map((pcmPath) => ({ pcmPath, offsetMs: 0, gain: 1 })) },
				openHandle,
				prepare,
			),
		).rejects.toThrow("Resample failed");
		expect(release).toHaveBeenCalledOnce();
		expect(prepare.mock.calls).toEqual([
			[low, 48000],
			[middle, 48000],
		]);
	});

	it("closes successfully opened inputs when a sibling open fails", async () => {
		const filePath = writeFloatWav("partial-open.wav", 1, 1000, [1]);
		const handle = await fsPromises.open(filePath, "r");
		await expect(
			resolveStream(
				{
					inputs: [
						{ pcmPath: filePath, offsetMs: 0, gain: 1 },
						{ pcmPath: "missing", offsetMs: 0, gain: 1 },
					],
				},
				(inputPath) =>
					inputPath === filePath ? Promise.resolve(handle) : Promise.reject(new Error("Missing input")),
			),
		).rejects.toThrow("Missing input");
		await expect(handle.stat()).rejects.toThrow();
	});
	it("sums two mono inputs at different offsets, folding each into both stereo channels", async () => {
		const a = writeFloatWav("sum-a.wav", 1, 1000, [1, 2, 3]);
		const b = writeFloatWav("sum-b.wav", 1, 1000, [10, 20]);

		await withStream(
			{
				inputs: [
					{ pcmPath: a, offsetMs: 0, gain: 1 },
					{ pcmPath: b, offsetMs: 1, gain: 1 },
				],
			},
			async (resolved) => {
				expect(resolved.outputChannels).toBe(2);
				expect(resolved.totalFrames).toBe(3);

				const rendered = await renderRange(resolved, 0, 3);

				expect(Array.from(rendered)).toEqual([1, 1, 12, 12, 23, 23]);
			},
		);
	});

	it("nulls an identical pair to exact zeros under gain -1", async () => {
		const a = writeFloatWav("null-a.wav", 1, 1000, [0.5, -0.5, 0.25]);
		const b = writeFloatWav("null-b.wav", 1, 1000, [0.5, -0.5, 0.25]);

		await withStream(
			{
				inputs: [
					{ pcmPath: a, offsetMs: 0, gain: 1 },
					{ pcmPath: b, offsetMs: 0, gain: -1 },
				],
			},
			async (resolved) => {
				const rendered = await renderRange(resolved, 0, 3);

				expect(Array.from(rendered)).toEqual([0, 0, 0, 0, 0, 0]);
			},
		);
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

		await withStream(
			{
				inputs: [
					{ pcmPath: mono, offsetMs: 0, gain: 1 },
					{ pcmPath: stereo, offsetMs: 0, gain: 1 },
				],
			},
			async (resolved) => {
				expect(resolved.outputChannels).toBe(2);

				const rendered = await renderRange(resolved, 0, 1);

				expect(Array.from(rendered)).toEqual([3, 4]);
			},
		);
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
