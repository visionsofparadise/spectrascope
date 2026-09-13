export function selectSpectralWindows(
	energy: Float64Array,
	samplesPerPoint: number,
	sampleCount: number,
	frameCount: number,
	fftSize: number,
	hopSize: number,
): ReadonlyArray<number> {
	const prefix = new Float64Array(energy.length + 1);

	for (let index = 0; index < energy.length; index++) prefix[index + 1] = prefix[index]! + energy[index]!;

	const integral = (sample: number) => prefix[Math.min(prefix.length - 1, Math.floor(sample / samplesPerPoint))]!;
	const starts: Array<number> = [];

	for (let frame = 0; frame < frameCount; frame++) {
		const first = Math.floor((frame * sampleCount) / frameCount);
		const last = Math.floor(((frame + 1) * sampleCount) / frameCount) - fftSize;
		let winner = first;
		let maximum = -Infinity;

		for (let candidate = first; ; candidate = Math.min(last, candidate + hopSize)) {
			const value = integral(candidate + fftSize) - integral(candidate);

			if (value > maximum) {
				maximum = value;
				winner = candidate;
			}

			if (candidate === last) break;
		}

		starts.push(winner);
	}

	return starts;
}
