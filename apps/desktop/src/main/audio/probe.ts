import { parseFile } from "music-metadata";

export interface AudioProbe {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly durationMs: number;
	readonly container: string;
	readonly codec: string;
}

export const probeAudioFile = async (filePath: string): Promise<AudioProbe> => {
	const { format } = await parseFile(filePath);

	const { sampleRate, numberOfChannels, duration, container, codec } = format;

	if (sampleRate === undefined) throw new Error(`Probe of "${filePath}" reported no sampleRate`);

	if (numberOfChannels === undefined) throw new Error(`Probe of "${filePath}" reported no numberOfChannels`);

	if (duration === undefined) throw new Error(`Probe of "${filePath}" reported no duration`);

	if (container === undefined) throw new Error(`Probe of "${filePath}" reported no container`);

	if (codec === undefined) throw new Error(`Probe of "${filePath}" reported no codec`);

	return {
		sampleRate,
		channelCount: numberOfChannels,
		durationMs: duration * 1000,
		container,
		codec,
	};
};
