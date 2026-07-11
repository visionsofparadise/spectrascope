import type fs from "node:fs/promises";

export interface WavHeader {
	readonly format: "int" | "float";
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly bitsPerSample: number;
	readonly bytesPerSample: number;
	readonly dataOffset: number;
	readonly dataByteLength: number;
	readonly frameCount: number;
}

const RIFF_SIZE_SENTINEL = 0xffffffff;

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

const readExact = async (fileHandle: fs.FileHandle, position: number, length: number): Promise<Buffer> => {
	const buffer = Buffer.alloc(length);

	const { bytesRead } = await fileHandle.read(buffer, 0, length, position);

	if (bytesRead < length) throw new Error(`Expected ${String(length)} bytes at offset ${String(position)} but read ${String(bytesRead)}`);

	return buffer;
};

const resolveFormat = (formatCode: number): "int" | "float" => {
	if (formatCode === WAVE_FORMAT_PCM) return "int";
	if (formatCode === WAVE_FORMAT_IEEE_FLOAT) return "float";

	throw new Error(`Unsupported WAV audio format code ${String(formatCode)} (expected 1 = PCM int, 3 = IEEE float, or 0xFFFE resolving to one)`);
};

export const parseWavHeader = async (fileHandle: fs.FileHandle): Promise<WavHeader> => {
	const riff = await readExact(fileHandle, 0, 12);
	const riffId = riff.toString("ascii", 0, 4);
	const waveId = riff.toString("ascii", 8, 12);

	if (riffId !== "RIFF" && riffId !== "RF64") throw new Error(`Not a RIFF/RF64 file (leading id "${riffId}")`);
	if (waveId !== "WAVE") throw new Error(`Not a WAVE file (form type "${waveId}")`);

	let ds64DataSize: number | null = null;

	let format: "int" | "float" | null = null;
	let sampleRate = 0;
	let channelCount = 0;
	let bitsPerSample = 0;

	let position = 12;

	for (;;) {
		const chunkHeader = await readExact(fileHandle, position, 8);
		const chunkId = chunkHeader.toString("ascii", 0, 4);
		const chunkSize = chunkHeader.readUInt32LE(4);
		const bodyOffset = position + 8;

		if (chunkId === "ds64") {
			const body = await readExact(fileHandle, bodyOffset, chunkSize);

			ds64DataSize = Number(body.readBigUInt64LE(8));
		} else if (chunkId === "fmt ") {
			const body = await readExact(fileHandle, bodyOffset, chunkSize);

			let formatCode = body.readUInt16LE(0);

			channelCount = body.readUInt16LE(2);
			sampleRate = body.readUInt32LE(4);
			bitsPerSample = body.readUInt16LE(14);

			if (formatCode === WAVE_FORMAT_EXTENSIBLE) {
				if (chunkSize < 40) throw new Error(`WAVE_FORMAT_EXTENSIBLE fmt chunk too small (${String(chunkSize)} bytes)`);

				formatCode = body.readUInt16LE(24);
			}

			format = resolveFormat(formatCode);
		} else if (chunkId === "data") {
			if (format === null) throw new Error("WAV file has no fmt chunk before data");

			const dataByteLength = chunkSize === RIFF_SIZE_SENTINEL && ds64DataSize !== null ? ds64DataSize : chunkSize;
			const bytesPerSample = bitsPerSample / 8;

			if (format === "int" && bitsPerSample !== 16 && bitsPerSample !== 24 && bitsPerSample !== 32) {
				throw new Error(`Unsupported integer PCM bit depth ${String(bitsPerSample)} (expected 16, 24, or 32)`);
			}

			if (format === "float" && bitsPerSample !== 32) {
				throw new Error(`Unsupported float PCM bit depth ${String(bitsPerSample)} (expected 32)`);
			}

			const frameCount = Math.floor(dataByteLength / (channelCount * bytesPerSample));

			return { format, sampleRate, channelCount, bitsPerSample, bytesPerSample, dataOffset: bodyOffset, dataByteLength, frameCount };
		}

		position = bodyOffset + chunkSize + (chunkSize % 2);
	}
};

const readSample = (buffer: Buffer, offset: number, header: WavHeader): number => {
	if (header.format === "float") return buffer.readFloatLE(offset);

	if (header.bitsPerSample === 16) return buffer.readInt16LE(offset) / 32768;
	if (header.bitsPerSample === 24) return buffer.readIntLE(offset, 3) / 8388608;

	return buffer.readInt32LE(offset) / 2147483648;
};

export const readFrames = async (fileHandle: fs.FileHandle, header: WavHeader, frameOffset: number, frameCount: number): Promise<Float32Array> => {
	const clampedOffset = Math.max(0, Math.min(frameOffset, header.frameCount));
	const clampedCount = Math.max(0, Math.min(frameCount, header.frameCount - clampedOffset));

	const bytesPerFrame = header.channelCount * header.bytesPerSample;
	const byteStart = header.dataOffset + clampedOffset * bytesPerFrame;
	const byteLength = clampedCount * bytesPerFrame;

	const output = new Float32Array(clampedCount * header.channelCount);

	if (byteLength === 0) return output;

	const buffer = Buffer.alloc(byteLength);
	const { bytesRead } = await fileHandle.read(buffer, 0, byteLength, byteStart);

	const sampleCount = Math.floor(bytesRead / header.bytesPerSample);

	for (let index = 0; index < sampleCount; index++) {
		output[index] = readSample(buffer, index * header.bytesPerSample, header);
	}

	return output;
};
