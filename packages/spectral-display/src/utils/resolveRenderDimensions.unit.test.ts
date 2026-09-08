import { describe, expect, it } from "vitest";
import { resolveRenderDimensions } from "./resolveRenderDimensions";

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

describe("physical render dimensions", () => {
	it("accepts physical pixels without multiplying device pixel ratio", () => {
		expect(resolveRenderDimensions({ width: 1920, height: 1080 }, deviceWith(), 2048)).toEqual({
			width: 1920,
			height: 1080,
		});
		expect(resolveRenderDimensions({ width: 1199.9, height: 0.8 }, deviceWith(), 2048)).toEqual({
			width: 1199,
			height: 1,
		});
	});

	it("preserves aspect ratio while respecting the texture dimension limit", () => {
		expect(resolveRenderDimensions({ width: 20000, height: 10000 }, deviceWith(), 2048)).toEqual({
			width: 8192,
			height: 4096,
		});
	});

	it("bounds spectral storage independently of the texture limit", () => {
		const device = deviceWith({ maxStorageBufferBindingSize: 1025 * 4 * 200 });
		expect(resolveRenderDimensions({ width: 1000, height: 500 }, device, 2048)).toEqual({ width: 200, height: 100 });
	});

	it.each([NaN, Infinity, 0, -1])("rejects invalid dimensions %s", (width) => {
		expect(() => resolveRenderDimensions({ width, height: 100 }, deviceWith(), 2048)).toThrow("finite and positive");
	});
});
