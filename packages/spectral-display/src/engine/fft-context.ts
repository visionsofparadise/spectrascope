export function resolveFftContext(
	startSample: number,
	endSample: number,
	totalSamples: number,
	fftSize: number,
): { startSample: number; endSample: number } {
	if (endSample <= startSample || endSample - startSample >= fftSize) return { startSample, endSample };

	const start =
		totalSamples < fftSize
			? Math.floor((totalSamples - fftSize) / 2)
			: Math.max(0, Math.min(totalSamples - fftSize, Math.floor((startSample + endSample - fftSize) / 2)));

	return { startSample: start, endSample: start + fftSize };
}
