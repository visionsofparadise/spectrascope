import { parseWavHeader, readFrames, type WavHeader } from "./wavReader";
import type fs from "node:fs/promises";

export interface StreamInput {
	readonly pcmPath: string;
	readonly offsetMs: number;
	readonly gain: 1 | -1;
}

export interface StreamSpec {
	readonly inputs: ReadonlyArray<StreamInput>;
}

export interface ResolvedInput {
	readonly header: WavHeader;
	readonly fileHandle: fs.FileHandle;
	readonly offsetFrames: number;
	readonly gain: 1 | -1;
	/**
	 * Interleaved `[L0, R0, L1, R1, …]` per-channel fold coefficients mapping this
	 * input's native channels to a stereo pair, or `null` for a single-input stream
	 * (which keeps the native channel count and copies directly).
	 */
	readonly foldCoefficients: Float32Array | null;
}

export interface ResolvedStream {
	readonly spec: StreamSpec;
	readonly sampleRate: number;
	readonly outputChannels: number;
	readonly totalFrames: number;
	readonly inputs: Array<ResolvedInput>;
}

const BS775_SURROUND_COEF = Math.SQRT1_2;

const deriveFoldCoefficients = (channelCount: number): Float32Array => {
	const coefficients = new Float32Array(channelCount * 2);

	if (channelCount === 1) {
		coefficients[0] = 1;
		coefficients[1] = 1;
	} else if (channelCount === 6) {
		coefficients[0] = 1;
		coefficients[4] = BS775_SURROUND_COEF;
		coefficients[8] = BS775_SURROUND_COEF;
		coefficients[3] = 1;
		coefficients[5] = BS775_SURROUND_COEF;
		coefficients[11] = BS775_SURROUND_COEF;
	} else {
		coefficients[0] = 1;
		coefficients[3] = 1;
	}

	return coefficients;
};

export const resolveStream = async (
	spec: StreamSpec,
	openHandle: (pcmPath: string) => Promise<fs.FileHandle>,
): Promise<ResolvedStream> => {
	if (spec.inputs.length === 0) throw new Error("Cannot resolve a stream with no inputs");

	const fileHandles = await Promise.all(spec.inputs.map((input) => openHandle(input.pcmPath)));

	try {
		const parsed = await Promise.all(
			spec.inputs.map(async (input, index) => {
				const fileHandle = fileHandles[index];

				if (fileHandle === undefined) throw new Error(`Missing file handle for stream input "${input.pcmPath}"`);

				return { input, fileHandle, header: await parseWavHeader(fileHandle) };
			}),
		);

		const multiInput = parsed.length > 1;

		let sampleRate = 0;
		let firstChannelCount = 0;
		let totalFrames = 0;

		const inputs = parsed.map(({ input, fileHandle, header }, index): ResolvedInput => {
			if (index === 0) {
				sampleRate = header.sampleRate;
				firstChannelCount = header.channelCount;
			} else if (header.sampleRate !== sampleRate) {
				throw new Error(
					`Stream input "${input.pcmPath}" sample rate ${String(header.sampleRate)} ≠ ${String(sampleRate)} (all inputs must share the canonical rate)`,
				);
			}

			const offsetFrames = Math.round((input.offsetMs * header.sampleRate) / 1000);

			totalFrames = Math.max(totalFrames, offsetFrames + header.frameCount);

			return {
				header,
				fileHandle,
				offsetFrames,
				gain: input.gain,
				foldCoefficients: multiInput ? deriveFoldCoefficients(header.channelCount) : null,
			};
		});

		const outputChannels = spec.inputs.length === 1 ? firstChannelCount : 2;

		return { spec, sampleRate, outputChannels, totalFrames, inputs };
	} catch (error) {
		await Promise.all(fileHandles.map((fileHandle) => fileHandle.close().catch(() => undefined)));

		throw error;
	}
};

const accumulateInput = (
	output: Float32Array,
	outputChannels: number,
	outputFrameStart: number,
	frames: Float32Array,
	inputChannels: number,
	frameCount: number,
	gain: 1 | -1,
	foldCoefficients: Float32Array | null,
): void => {
	if (foldCoefficients === null) {
		for (let frame = 0; frame < frameCount; frame++) {
			const inputBase = frame * inputChannels;
			const outputBase = (outputFrameStart + frame) * outputChannels;

			for (let channel = 0; channel < outputChannels; channel++) {
				const outputIndex = outputBase + channel;

				output[outputIndex] = (output[outputIndex] ?? 0) + gain * (frames[inputBase + channel] ?? 0);
			}
		}

		return;
	}

	for (let frame = 0; frame < frameCount; frame++) {
		const inputBase = frame * inputChannels;
		const outputBase = (outputFrameStart + frame) * 2;

		let left = 0;
		let right = 0;

		for (let channel = 0; channel < inputChannels; channel++) {
			const sample = frames[inputBase + channel] ?? 0;

			left += sample * (foldCoefficients[channel * 2] ?? 0);
			right += sample * (foldCoefficients[channel * 2 + 1] ?? 0);
		}

		output[outputBase] = (output[outputBase] ?? 0) + gain * left;
		output[outputBase + 1] = (output[outputBase + 1] ?? 0) + gain * right;
	}
};

export const renderRange = async (
	resolved: ResolvedStream,
	frameOffset: number,
	frameCount: number,
): Promise<Float32Array> => {
	const { outputChannels, inputs } = resolved;
	const output = new Float32Array(frameCount * outputChannels);

	await Promise.all(
		inputs.map(async (input) => {
			const inputFrameCount = input.header.frameCount;
			const overlapStart = Math.max(frameOffset, input.offsetFrames);
			const overlapEnd = Math.min(frameOffset + frameCount, input.offsetFrames + inputFrameCount);

			if (overlapEnd <= overlapStart) return;

			const inputReadOffset = overlapStart - input.offsetFrames;
			const overlapCount = overlapEnd - overlapStart;
			const frames = await readFrames(input.fileHandle, input.header, inputReadOffset, overlapCount);

			accumulateInput(
				output,
				outputChannels,
				overlapStart - frameOffset,
				frames,
				input.header.channelCount,
				overlapCount,
				input.gain,
				input.foldCoefficients,
			);
		}),
	);

	return output;
};
