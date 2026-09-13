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

export type PrepareStreamInput = (
	pcmPath: string,
	sampleRate: number,
) => Promise<{ readonly pcmPath: string; readonly release: () => void }>;

interface ResolvedInput {
	readonly pcmPath: string;
	readonly header: WavHeader;
	readonly fileHandle: fs.FileHandle;
	readonly releasePreparedSource?: () => void;
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
	prepareInput?: PrepareStreamInput,
): Promise<ResolvedStream> => {
	if (spec.inputs.length === 0) throw new Error("Cannot resolve a stream with no inputs");

	const opened = await Promise.allSettled(spec.inputs.map((input) => openHandle(input.pcmPath)));
	const fileHandles = opened.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
	const failed = opened.find((result) => result.status === "rejected");

	if (failed?.status === "rejected") {
		await Promise.all(fileHandles.map((fileHandle) => fileHandle.close().catch(() => undefined)));

		throw failed.reason;
	}

	const ownedHandles = new Set(fileHandles);
	const releases: Array<() => void> = [];

	try {
		const parsed: Array<{ input: StreamInput; fileHandle: fs.FileHandle; header: WavHeader }> = [];

		for (const [index, input] of spec.inputs.entries()) {
			const fileHandle = fileHandles[index];

			if (fileHandle === undefined) throw new Error(`Missing file handle for stream input "${input.pcmPath}"`);

			parsed.push({ input, fileHandle, header: await parseWavHeader(fileHandle) });
		}

		const sampleRate = Math.max(...parsed.map(({ header }) => header.sampleRate));
		const inputs: Array<ResolvedInput> = [];
		let totalFrames = 0;

		for (const original of parsed) {
			const { input } = original;
			let { header, fileHandle } = original;
			let pcmPath = input.pcmPath;
			let releasePreparedSource: (() => void) | undefined;

			if (header.sampleRate !== sampleRate) {
				if (!prepareInput) throw new Error("Mixed-rate streams require source preparation");

				const prepared = await prepareInput(pcmPath, sampleRate);
				let released = false;

				releasePreparedSource = () => {
					if (released) return;

					released = true;
					prepared.release();
				};
				releases.push(releasePreparedSource);
				pcmPath = prepared.pcmPath;
				fileHandle = await openHandle(pcmPath);
				ownedHandles.add(fileHandle);
				header = await parseWavHeader(fileHandle);

				if (header.sampleRate !== sampleRate || header.channelCount !== original.header.channelCount)
					throw new Error("Prepared stream input has an unexpected sample rate or channel count");

				await original.fileHandle.close();
				ownedHandles.delete(original.fileHandle);
			}

			const offsetFrames = Math.round((input.offsetMs * sampleRate) / 1000);

			totalFrames = Math.max(totalFrames, offsetFrames + header.frameCount);
			inputs.push({
				pcmPath,
				header,
				fileHandle,
				releasePreparedSource,
				offsetFrames,
				gain: input.gain,
				foldCoefficients: parsed.length > 1 ? deriveFoldCoefficients(header.channelCount) : null,
			});
		}

		const firstInput = inputs[0];

		if (!firstInput) throw new Error("Stream has no resolved inputs");

		const outputChannels = spec.inputs.length === 1 ? firstInput.header.channelCount : 2;

		return { spec, sampleRate, outputChannels, totalFrames, inputs };
	} catch (error) {
		await Promise.all([...ownedHandles].map((fileHandle) => fileHandle.close().catch(() => undefined)));
		await Promise.allSettled(releases.map((release) => Promise.resolve().then(release)));

		throw error;
	}
};

export async function closeResolvedStream(resolved: ResolvedStream): Promise<void> {
	await Promise.all(
		resolved.inputs.map(async (input) => {
			await input.fileHandle.close().catch(() => undefined);
			input.releasePreparedSource?.();
		}),
	);
}

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
