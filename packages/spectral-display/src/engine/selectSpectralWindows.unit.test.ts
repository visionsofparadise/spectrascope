import { describe, expect, it } from "vitest";
import { selectSpectralWindows } from "./selectSpectralWindows";

function summaries(samples: Float32Array, step: number): Float64Array {
	const energy = new Float64Array(Math.ceil(samples.length / step));
	for (let index = 0; index < samples.length; index++) energy[Math.floor(index / step)]! += samples[index]! ** 2;
	return energy;
}

function oracle(samples: Float32Array, count: number, frames: number, fftSize: number, hop: number): Array<number> {
	return Array.from({ length: frames }, (_, frame) => {
		const first = Math.floor((frame * count) / frames);
		const last = Math.floor(((frame + 1) * count) / frames) - fftSize;
		let best = first;
		let maximum = -Infinity;
		for (let start = first; ; start = Math.min(last, start + hop)) {
			let energy = 0;
			for (let index = start; index < start + fftSize; index++) energy += (samples[index] ?? 0) ** 2;
			if (energy > maximum) {
				maximum = energy;
				best = start;
			}
			if (start === last) return best;
		}
	});
}

describe("cached energy spectral selection", () => {
	it.each([2, 3, 4, 5, 7, 8, 16, 32])("matches a direct RMS oracle at overlap %s", (overlap) => {
		const samples = Float32Array.from(
			{ length: 32768 },
			(_, index) => (((index * 97 + (index % 13) ** 3) % 101) - 50) / 64,
		);
		for (const fftSize of [256, 512, 1024]) {
			const hop = Math.floor(fftSize / overlap);
			const step = Math.min(256, hop & -hop);
			expect(selectSpectralWindows(summaries(samples, step), step, samples.length, 8, fftSize, hop)).toEqual(
				oracle(samples, samples.length, 8, fftSize, hop),
			);
		}
	});

	it("selects windows spanning summary boundaries and counts padded tail samples as zero", () => {
		const samples = new Float32Array(967);
		samples[127] = 3;
		samples[128] = 4;
		samples[965] = 5;
		const result = selectSpectralWindows(summaries(samples, 16), 16, 1024, 4, 64, 16);
		expect(result).toEqual(oracle(samples, 1024, 4, 64, 16));
		expect(result[0]).toBe(80);
		expect(result[3]).toBe(912);
	});

	it("retains deterministic earliest winners and never mutates reusable summaries", () => {
		const energy = new Float64Array(64).fill(1);
		const before = energy.slice();
		const first = selectSpectralWindows(energy, 16, 1024, 4, 64, 16);
		expect(first).toEqual([0, 256, 512, 768]);
		expect(selectSpectralWindows(energy, 16, 1024, 4, 64, 16)).toEqual(first);
		expect(energy).toEqual(before);
	});
});
