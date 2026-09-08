import { renderRange, type ResolvedStream } from "../audio/streamDsp";
import { buildWavHeader } from "../audio/wavHeader";
import { withAtomicFile } from "../utils/writeFileAtomically";
import type { ExportStreamOptions } from "../../shared/models/Export";
import type fs from "node:fs/promises";

const CHUNK_FRAMES = 65536;
const MAX_CSV_BINS = 1000;

function ceilingSample(value: number): number {
	return Math.ceil(value - Number.EPSILON * Math.max(1, Math.abs(value)) * 4);
}

export function resolveExportRange(
	stream: ResolvedStream,
	options: Pick<ExportStreamOptions, "startMs" | "endMs">,
): { start: number; end: number } {
	const startMs = options.startMs ?? 0;
	const endMs = options.endMs ?? (stream.totalFrames / stream.sampleRate) * 1000;

	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error("Export times must be finite.");

	const start = Math.max(0, Math.min(stream.totalFrames, ceilingSample((startMs * stream.sampleRate) / 1000)));
	const end = Math.max(0, Math.min(stream.totalFrames, ceilingSample((endMs * stream.sampleRate) / 1000)));

	if (end <= start) throw new Error("The selected export range contains no audio samples.");

	return { start, end };
}

async function writeBytes(handle: fs.FileHandle, data: Uint8Array): Promise<void> {
	let written = 0;

	while (written < data.byteLength) {
		const result = await handle.write(data, written, data.byteLength - written);

		if (result.bytesWritten <= 0) throw new Error("The export destination stopped accepting data.");

		written += result.bytesWritten;
	}
}

async function writeWav(handle: fs.FileHandle, stream: ResolvedStream, start: number, end: number): Promise<void> {
	await writeBytes(handle, buildWavHeader(stream.sampleRate, stream.outputChannels, end - start));

	for (let offset = start; offset < end; offset += CHUNK_FRAMES) {
		const samples = await renderRange(stream, offset, Math.min(CHUNK_FRAMES, end - offset));
		const bytes = Buffer.allocUnsafe(samples.length * 4);

		for (let index = 0; index < samples.length; index++) bytes.writeFloatLE(samples[index] ?? 0, index * 4);

		await writeBytes(handle, bytes);
	}
}

async function writeCsv(handle: fs.FileHandle, stream: ResolvedStream, start: number, end: number): Promise<void> {
	await writeBytes(handle, Buffer.from("start_seconds,end_seconds,channel,min,max,rms\n"));

	const binFrames = Math.max(1, Math.ceil((end - start) / MAX_CSV_BINS));
	const channels = stream.outputChannels;
	const minimum = new Float64Array(channels).fill(Infinity);
	const maximum = new Float64Array(channels).fill(-Infinity);
	const squares = new Float64Array(channels);
	let binStart = start;
	let count = 0;

	for (let offset = start; offset < end; offset += CHUNK_FRAMES) {
		const frameCount = Math.min(CHUNK_FRAMES, end - offset);
		const samples = await renderRange(stream, offset, frameCount);
		const rows: Array<string> = [];

		for (let frame = 0; frame < frameCount; frame++) {
			for (let channel = 0; channel < channels; channel++) {
				const value = samples[frame * channels + channel] ?? 0;

				if (!Number.isFinite(value))
					throw new Error("Audio contains a non-finite sample; CSV export cannot measure it.");

				minimum[channel] = Math.min(minimum[channel] ?? Infinity, value);
				maximum[channel] = Math.max(maximum[channel] ?? -Infinity, value);
				squares[channel] = (squares[channel] ?? 0) + value * value;
			}

			count++;

			const binEnd = offset + frame + 1;

			if (count === binFrames || binEnd === end) {
				for (let channel = 0; channel < channels; channel++)
					rows.push(
						`${binStart / stream.sampleRate},${binEnd / stream.sampleRate},${channel + 1},${minimum[channel]},${maximum[channel]},${Math.sqrt((squares[channel] ?? 0) / count)}\n`,
					);

				binStart = binEnd;
				count = 0;
				minimum.fill(Infinity);
				maximum.fill(-Infinity);
				squares.fill(0);
			}
		}

		if (rows.length > 0) await writeBytes(handle, Buffer.from(rows.join("")));
	}
}

export async function writeStreamExport(
	filePath: string,
	stream: ResolvedStream,
	options: Pick<ExportStreamOptions, "kind" | "startMs" | "endMs">,
): Promise<void> {
	const { start, end } = resolveExportRange(stream, options);

	await withAtomicFile(filePath, async (handle) => {
		if (options.kind === "wav") await writeWav(handle, stream, start, end);
		else await writeCsv(handle, stream, start, end);
	});
}
