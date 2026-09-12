import { describe, expect, it } from "vitest";
import { StratifiedSpectrogramSampler } from "./StratifiedSpectrogramSampler";

function select(samples: Float32Array, strata: number, fftSize: number, hop: number, chunkSize: number) {
	const batches: Array<Float32Array> = [];
	const sampler = new StratifiedSpectrogramSampler(samples.length, strata, fftSize, hop, (batch, count) => {
		batches.push(batch.slice(0, count));
	});

	for (let offset = 0; offset < samples.length; offset += chunkSize) {
		const chunk = samples.subarray(offset, offset + chunkSize);
		sampler.consume(chunk, chunk.length);
	}

	sampler.finish();
	return batches;
}

function reference(samples: Float32Array, strata: number, fftSize: number, hop: number): Float32Array {
	const output: Array<number> = [];
	for (let stratum = 0; stratum < strata; stratum++) {
		const start = Math.floor((stratum * samples.length) / strata);
		const final = Math.floor(((stratum + 1) * samples.length) / strata) - fftSize;
		const candidates = new Set<number>();
		for (let offset = start; offset <= final; offset += hop) candidates.add(offset);
		candidates.add(final);
		const ranked = [...candidates].map((offset) => {
			const window = samples.slice(offset, offset + fftSize);
			return { offset, window, energy: window.reduce((sum, sample) => sum + sample * sample, 0) };
		});
		ranked.sort((first, second) => second.energy - first.energy || first.offset - second.offset);
		output.push(...ranked[0]!.window);
	}
	return new Float32Array(output);
}

describe("stratified spectrogram window selection", () => {
	it.each([1, 3, 7, 31, 257])("matches independent RMS selection across %i-sample chunks", (chunkSize) => {
		const samples = Float32Array.from({ length: 257 }, (_, index) => ((index * 31) % 43) - 21);
		const batches = select(samples, 8, 8, 2, chunkSize);
		expect(batches).toEqual([reference(samples, 8, 8, 2)]);
	});

	it("chooses the earliest equal-energy window and includes unaligned stratum ends", () => {
		const samples = new Float32Array([1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
		expect(select(samples, 2, 4, 4, 3)).toEqual([new Float32Array([1, 0, 0, 0, 0, 0, 0, 3])]);
	});

	it("submits bounded batches made entirely of independent full windows", () => {
		const samples = new Float32Array(262144).fill(0.5);
		const batches = select(samples, 32769, 4, 2, 131072);
		expect(batches.map((batch) => batch.length)).toEqual([131072, 4]);
		expect(batches.every((batch) => batch.every((sample) => sample === 0.5))).toBe(true);
	});

	it("rejects incomplete scans", () => {
		const sampler = new StratifiedSpectrogramSampler(32, 2, 4, 2, () => undefined);
		sampler.consume(new Float32Array(8), 8);
		expect(() => sampler.finish()).toThrow("before all strata");
	});

	it("retains a quiet stratum winner following a loud stratum in the same chunk", () => {
		const samples = new Float32Array(131072);
		samples.fill(1, 0, 65536);
		samples.fill(2.5e-6, samples.length - 256);
		const selected = select(samples, 2, 256, 64, samples.length)[0]!;
		expect(selected.slice(0, 256).every((sample) => sample === 1)).toBe(true);
		expect(selected.slice(256).every((sample) => sample === samples.at(-1))).toBe(true);
	});
});
