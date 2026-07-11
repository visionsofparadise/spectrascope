const UINT32_MAX = 0xffffffff;
const STANDARD_HEADER_BYTES = 44;
const RF64_HEADER_BYTES = 80;

const WAVE_FORMAT_IEEE_FLOAT = 3;
const BITS_PER_SAMPLE = 32;
const BYTES_PER_SAMPLE = 4;

const DS64_BODY_BYTES = 28;
const FMT_BODY_BYTES = 16;

/**
 * A plain RIFF header's `riffSize` field is the total file size minus 8, i.e.
 * `36 + dataBytes`. When that 32-bit field would overflow, the RF64 layout is
 * required instead.
 */
const needsRf64 = (dataBytes: number): boolean => STANDARD_HEADER_BYTES - 8 + dataBytes > UINT32_MAX;

/** Byte length of the header `buildWavHeader` emits for these dimensions. */
export const headerLength = (frameCount: number, channelCount: number): number =>
	needsRf64(frameCount * channelCount * BYTES_PER_SAMPLE) ? RF64_HEADER_BYTES : STANDARD_HEADER_BYTES;

/**
 * Emits the header bytes for a virtual IEEE-float (32-bit) PCM WAV of the given
 * dimensions: a standard 44-byte RIFF header under 4 GiB, or an RF64 header
 * (`RF64` id, 32-bit size sentinels, a `ds64` chunk carrying 64-bit riff/data
 * sizes + sample count) at or above it. No sample data is written.
 */
export const buildWavHeader = (sampleRate: number, channelCount: number, frameCount: number): Buffer => {
	const dataBytes = frameCount * channelCount * BYTES_PER_SAMPLE;
	const byteRate = sampleRate * channelCount * BYTES_PER_SAMPLE;
	const blockAlign = channelCount * BYTES_PER_SAMPLE;

	if (!needsRf64(dataBytes)) {
		const header = Buffer.alloc(STANDARD_HEADER_BYTES);

		header.write("RIFF", 0, "ascii");
		header.writeUInt32LE(STANDARD_HEADER_BYTES - 8 + dataBytes, 4);
		header.write("WAVE", 8, "ascii");
		header.write("fmt ", 12, "ascii");
		header.writeUInt32LE(FMT_BODY_BYTES, 16);
		header.writeUInt16LE(WAVE_FORMAT_IEEE_FLOAT, 20);
		header.writeUInt16LE(channelCount, 22);
		header.writeUInt32LE(sampleRate, 24);
		header.writeUInt32LE(byteRate, 28);
		header.writeUInt16LE(blockAlign, 32);
		header.writeUInt16LE(BITS_PER_SAMPLE, 34);
		header.write("data", 36, "ascii");
		header.writeUInt32LE(dataBytes, 40);

		return header;
	}

	const header = Buffer.alloc(RF64_HEADER_BYTES);

	header.write("RF64", 0, "ascii");
	header.writeUInt32LE(UINT32_MAX, 4);
	header.write("WAVE", 8, "ascii");

	header.write("ds64", 12, "ascii");
	header.writeUInt32LE(DS64_BODY_BYTES, 16);
	header.writeBigUInt64LE(BigInt(RF64_HEADER_BYTES - 8 + dataBytes), 20); // riffSize (file size − 8)
	header.writeBigUInt64LE(BigInt(dataBytes), 28); // dataSize
	header.writeBigUInt64LE(BigInt(frameCount), 36); // sampleCount (frames)
	header.writeUInt32LE(0, 44); // table length

	header.write("fmt ", 48, "ascii");
	header.writeUInt32LE(FMT_BODY_BYTES, 52);
	header.writeUInt16LE(WAVE_FORMAT_IEEE_FLOAT, 56);
	header.writeUInt16LE(channelCount, 58);
	header.writeUInt32LE(sampleRate, 60);
	header.writeUInt32LE(byteRate, 64);
	header.writeUInt16LE(blockAlign, 68);
	header.writeUInt16LE(BITS_PER_SAMPLE, 70);

	header.write("data", 72, "ascii");
	header.writeUInt32LE(UINT32_MAX, 76);

	return header;
};
