function frequencyToMel(frequencyHz: number): number {
	return 2595 * Math.log10(1 + frequencyHz / 700);
}

export function frequencyToFraction(frequencyHz: number, sampleRate: number): number {
	const minimum = frequencyToMel(20);
	const maximum = frequencyToMel(sampleRate / 2);

	return 1 - (frequencyToMel(frequencyHz) - minimum) / (maximum - minimum);
}

export function fractionToFrequency(fraction: number, sampleRate: number): number {
	const minimum = frequencyToMel(20);
	const maximum = frequencyToMel(sampleRate / 2);
	const mel = maximum - Math.max(0, Math.min(1, fraction)) * (maximum - minimum);

	return 700 * (Math.pow(10, mel / 2595) - 1);
}
