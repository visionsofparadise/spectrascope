import { describe, expect, it } from "vitest";
import { displayTiles } from "./displayTiles";

const metadata = { sampleRate: 48000, sampleCount: 1_000_123, channelCount: 2 };
function deviceWith(limits: Partial<GPUSupportedLimits> = {}): GPUDevice {
	return {
		limits: {
			maxTextureDimension2D: 8192,
			maxBufferSize: 268435456,
			maxStorageBufferBindingSize: 134217728,
			maxComputeWorkgroupStorageSize: 32768,
			...limits,
		},
	} as GPUDevice;
}

describe("source-anchored display tiles", () => {
	it("keeps the same power-of-two level through floating-point pan drift and source clipping", () => {
		const query = { startSample: 0, endSample: 102400, requestedSampleCount: 102400, width: 800, height: 400 };
		for (const device of [deviceWith(), deviceWith({ maxTextureDimension2D: 512 })]) {
			const expected = displayTiles(query, metadata, device, 4096)!;
			for (const difference of [-1e-9, 0, 1e-9]) {
				const result = displayTiles(
					{ ...query, endSample: 10000, requestedSampleCount: 102400 + difference },
					metadata,
					device,
					4096,
				)!;
				expect(result.samplesPerColumn).toBe(expected.samplesPerColumn);
				expect(result.width).toBeLessThanOrEqual(device.limits.maxTextureDimension2D);
			}
		}
	});
	it("retains identical bins and tiles through overlapping pans", () => {
		const first = displayTiles(
			{ startSample: 1000, endSample: 101000, width: 800, height: 400 },
			metadata,
			deviceWith(),
			4096,
		)!;
		const second = displayTiles(
			{ startSample: 12000, endSample: 112000, width: 800, height: 400 },
			metadata,
			deviceWith(),
			4096,
		)!;
		expect(first.samplesPerColumn).toBe(64);
		expect(first.waveformSamplesPerPoint).toBe(32);
		expect(first.tileSamples).toBe(16384);
		expect(second.samplesPerColumn).toBe(first.samplesPerColumn);
		expect(second.tileStarts.filter((start) => first.tileStarts.includes(start))).toEqual(first.tileStarts);
		expect(first.startSample).toBe(0);
		expect(first.displayEndSample).toBeGreaterThanOrEqual(101000);
	});

	it("preserves nominal tail coverage and actual source endpoint independently", () => {
		const result = displayTiles(
			{ startSample: 950000, endSample: metadata.sampleCount, width: 800, height: 400 },
			metadata,
			deviceWith(),
			4096,
		)!;
		expect(result.endSample).toBe(metadata.sampleCount);
		expect(result.displayEndSample).toBeGreaterThan(metadata.sampleCount);
		expect(result.displayEndSample % result.tileSamples).toBe(0);
		expect(result.startSample % result.tileSamples).toBe(0);
		expect(result.width).toBe(result.tileStarts.length * result.tileWidth);
	});

	it("leaves fine sample rendering to the exact pipeline", () => {
		expect(
			displayTiles({ startSample: 10, endSample: 1000, width: 800, height: 400 }, metadata, deviceWith(), 4096),
		).toBeNull();
		expect(
			displayTiles({ startSample: 1000, endSample: 1000, width: 800, height: 400 }, metadata, deviceWith(), 4096),
		).toBeNull();
	});

	it("retains the same level across tile-boundary pans under GPU limits", () => {
		const device = deviceWith({ maxTextureDimension2D: 512 });
		const levels = [];
		for (let startSample = 0; startSample < 100000; startSample += 1379) {
			const result = displayTiles(
				{ startSample, endSample: startSample + 100000, width: 800, height: 900 },
				metadata,
				device,
				4096,
			)!;
			expect(result.width).toBeLessThanOrEqual(512);
			expect(result.height).toBeLessThanOrEqual(512);
			levels.push(result.samplesPerColumn);
		}
		expect(new Set(levels).size).toBe(1);
	});

	it.each([1, 50, 200])("bounds assembled width to %s spectral storage columns", (maximumWidth) => {
		const device = deviceWith({ maxStorageBufferBindingSize: 2049 * 4 * maximumWidth });
		const result = displayTiles(
			{ startSample: 99000, endSample: 199000, width: 800, height: 400 },
			metadata,
			device,
			4096,
		)!;
		expect(result.width).toBeLessThanOrEqual(maximumWidth);
		expect(result.tileWidth).toBeLessThanOrEqual(256);
		expect(result.startSample).toBeLessThanOrEqual(99000);
		expect(result.displayEndSample).toBeGreaterThanOrEqual(199000);
	});
});
