import { describe, expect, it } from "vitest";
import { WaveformTileCache } from "./WaveformTileCache";

const owner = async () => new Float32Array();

function put(
	cache: WaveformTileCache,
	start: number,
	end: number,
	samplesPerPoint: number,
	key = "mono",
	reader = owner,
) {
	const waveform = new Float32Array(Math.ceil((end - start) / samplesPerPoint) * 2);
	const energy = new Float64Array(waveform.length / 2);
	for (let index = 0; index < energy.length; index++) {
		const first = start + index * samplesPerPoint;
		const last = Math.min(end, first + samplesPerPoint);
		waveform[index * 2] = first + 1;
		waveform[index * 2 + 1] = last;
		for (let sample = first; sample < last; sample++) energy[index]! += (sample + 1) ** 2;
	}
	cache.set(reader, key, start, end, samplesPerPoint, waveform, energy);
	return { waveform, energy };
}

describe("waveform tile summaries", () => {
	it("composes adjacent finer tiles and coarsens exact extrema and energy", () => {
		const cache = new WaveformTileCache();
		put(cache, 0, 8, 2);
		put(cache, 8, 16, 2);
		const result = cache.get(owner, "mono", 4, 16, 4)!;
		expect([...result.waveformBuffer]).toEqual([5, 8, 9, 12, 13, 16]);
		expect([...result.waveformEnergyBuffer]).toEqual([174, 446, 846]);
		expect(result.waveformSamplesPerPoint).toBe(4);
		expect(result.waveformPointCount).toBe(3);
		expect(cache.get(owner, "mono", 0, 16, 16)?.waveformBuffer).toEqual(new Float32Array([1, 16]));
	});

	it("preserves positive partial EOF extrema and rejects unknown or split edge coverage", () => {
		const cache = new WaveformTileCache();
		put(cache, 0, 8, 2);
		put(cache, 8, 11, 2);
		expect(cache.get(owner, "mono", 0, 11, 8)?.waveformBuffer).toEqual(new Float32Array([1, 8, 9, 11]));
		expect(cache.get(owner, "mono", 8, 11, 4)?.waveformEnergyBuffer).toEqual(new Float64Array([302]));
		expect(cache.get(owner, "mono", 0, 12, 4)).toBeUndefined();
		expect(cache.get(owner, "mono", 0, 9, 4)).toBeUndefined();
		expect(cache.get(owner, "mono", 1, 8, 4)).toBeUndefined();
	});

	it("misses gaps, finer requests and incompatible signal identities", () => {
		const cache = new WaveformTileCache();
		put(cache, 0, 4, 2);
		put(cache, 8, 12, 2);
		expect(cache.get(owner, "mono", 0, 12, 4)).toBeUndefined();
		expect(cache.get(owner, "mono", 0, 4, 1)).toBeUndefined();
		expect(cache.get(owner, "side", 0, 4, 2)).toBeUndefined();
		expect(cache.get(async () => new Float32Array(), "mono", 0, 4, 2)).toBeUndefined();
	});

	it("owns both input and returned arrays", () => {
		const cache = new WaveformTileCache();
		const input = put(cache, 0, 4, 2);
		input.waveform.fill(-100);
		input.energy.fill(-100);
		const first = cache.get(owner, "mono", 0, 4, 2)!;
		expect([...first.waveformBuffer]).toEqual([1, 2, 3, 4]);
		expect([...first.waveformEnergyBuffer]).toEqual([5, 25]);
		first.waveformBuffer.fill(0);
		first.waveformEnergyBuffer.fill(0);
		expect([...cache.get(owner, "mono", 0, 4, 2)!.waveformBuffer]).toEqual([1, 2, 3, 4]);
		expect([...cache.get(owner, "mono", 0, 4, 2)!.waveformEnergyBuffer]).toEqual([5, 25]);
	});

	it("evicts globally by bytes and refreshes successfully used entries", () => {
		const cache = new WaveformTileCache(64);
		const other = async () => new Float32Array();
		put(cache, 0, 4, 2);
		put(cache, 4, 8, 2, "mono", other);
		expect(cache.get(owner, "mono", 0, 4, 2)).toBeDefined();
		put(cache, 8, 12, 2);
		expect(cache.get(other, "mono", 4, 8, 2)).toBeUndefined();
		expect(cache.get(owner, "mono", 0, 4, 2)).toBeDefined();
		put(cache, 0, 100, 2);
		expect(cache.get(owner, "mono", 0, 4, 2)).toBeDefined();
	});

	it("bounds entry count and replaces matching entries without accumulating their bytes", () => {
		const cache = new WaveformTileCache(64, 1);
		put(cache, 0, 4, 2);
		put(cache, 0, 4, 2);
		expect(cache.get(owner, "mono", 0, 4, 2)).toBeDefined();
		put(cache, 4, 8, 2);
		expect(cache.get(owner, "mono", 0, 4, 2)).toBeUndefined();
		expect(cache.get(owner, "mono", 4, 8, 2)).toBeDefined();
	});
});
