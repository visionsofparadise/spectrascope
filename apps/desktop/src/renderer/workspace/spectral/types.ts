export interface AudioData {
	sampleRate: number;
	channels: number;
	totalSamples: number;
	durationMs: number;
	readSamples: (
		channel: number,
		sampleOffset: number,
		sampleCount: number,
		signal?: AbortSignal,
	) => Promise<Float32Array>;
}
