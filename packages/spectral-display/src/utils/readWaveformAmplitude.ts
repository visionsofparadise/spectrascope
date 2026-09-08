import type { ComputeResultReady } from "../useSpectralCompute";

export interface WaveformAmplitude {
	readonly min: number;
	readonly max: number;
	readonly peak: number;
	readonly startMs: number;
	readonly endMs: number;
}

export function readWaveformAmplitude(result: ComputeResultReady, timeMs: number): WaveformAmplitude | null {
	const { waveformBuffer, waveformPointCount, waveformSamplesPerPoint } = result;
	const { startSample, endSample } = result.options.sampleQuery;
	const { sampleRate } = result.options.metadata;
	const startMs = (startSample * 1000) / sampleRate;
	const endMs = (endSample * 1000) / sampleRate;

	if (
		!waveformBuffer ||
		waveformPointCount <= 0 ||
		waveformSamplesPerPoint <= 0 ||
		!Number.isFinite(timeMs) ||
		timeMs < startMs ||
		timeMs >= endMs
	)
		return null;

	const absoluteSample = (timeMs * sampleRate) / 1000;
	const rawRelativeSample = absoluteSample - startSample;
	const nearestSample = Math.round(rawRelativeSample);
	const tolerance = Number.EPSILON * Math.max(1, Math.abs(absoluteSample), Math.abs(startSample)) * 4;
	const relativeSample = Math.abs(rawRelativeSample - nearestSample) <= tolerance ? nearestSample : rawRelativeSample;
	const point = Math.min(waveformPointCount - 1, Math.floor(relativeSample / waveformSamplesPerPoint));
	const min = waveformBuffer[point * 2];
	const max = waveformBuffer[point * 2 + 1];

	if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max)) return null;

	return {
		min,
		max,
		peak: Math.max(Math.abs(min), Math.abs(max)),
		startMs: ((startSample + point * waveformSamplesPerPoint) * 1000) / sampleRate,
		endMs: (Math.min(endSample, startSample + (point + 1) * waveformSamplesPerPoint) * 1000) / sampleRate,
	};
}
