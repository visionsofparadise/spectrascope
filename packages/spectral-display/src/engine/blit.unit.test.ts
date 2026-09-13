import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlitRenderer } from "./blit";

function setup() {
	const rangeBuffer = { destroy: vi.fn() };
	const canvas = { width: 300, height: 150, getContext: vi.fn() };
	const context = {
		canvas,
		configure: vi.fn(),
		unconfigure: vi.fn(),
		getCurrentTexture: () => ({ createView: vi.fn() }),
	};
	canvas.getContext.mockReturnValue(context);
	const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
	const device = {
		limits: { maxTextureDimension2D: 8192 },
		queue: { writeBuffer: vi.fn(), submit: vi.fn() },
		createSampler: vi.fn(),
		createShaderModule: vi.fn(),
		createRenderPipeline: () => ({ getBindGroupLayout: vi.fn() }),
		createBuffer: () => rangeBuffer,
		createBindGroup: vi.fn(),
		createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: vi.fn() }),
	};
	const renderer = new BlitRenderer(device as unknown as GPUDevice, canvas as unknown as HTMLCanvasElement);
	return { renderer, device, context, canvas, rangeBuffer, texture: { createView: vi.fn() } as unknown as GPUTexture };
}

beforeEach(() => {
	vi.stubGlobal("GPUBufferUsage", { UNIFORM: 64, COPY_DST: 8 });
	vi.stubGlobal("navigator", { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } });
});
afterEach(() => vi.unstubAllGlobals());

describe("blit frequency crop", () => {
	it("maps normalized top and bottom without reallocating output", () => {
		const { renderer, device, texture, canvas } = setup();
		renderer.render(texture, { top: 0.25, bottom: 0.75 });
		expect(device.queue.writeBuffer.mock.calls[0]?.[2]).toEqual(new Float32Array([0.25, 0.75, 0, 1]));
		expect(canvas).toMatchObject({ width: 300, height: 150 });
		renderer.render(texture);
		expect(device.queue.writeBuffer.mock.calls[1]?.[2]).toEqual(new Float32Array([0, 1, 0, 1]));
	});

	it.each([
		{ top: 1, bottom: 0 },
		{ top: NaN, bottom: 1 },
		{ top: 0.5, bottom: 0.5 },
		{ top: 0.25, bottom: Infinity },
	])("falls back to full texture for invalid crop", (range) => {
		const { renderer, device, texture } = setup();
		renderer.render(texture, range);
		expect(device.queue.writeBuffer.mock.calls[0]?.[2]).toEqual(new Float32Array([0, 1, 0, 1]));
	});

	it("crops time and frequency independently with safe horizontal defaults", () => {
		const { renderer, device, texture } = setup();
		renderer.render(texture, { top: 0.25, bottom: 0.75 }, { left: 0.4, right: 0.6 });
		expect(device.queue.writeBuffer.mock.calls[0]?.[2]).toEqual(new Float32Array([0.25, 0.75, 0.4, 0.6]));
		renderer.render(texture, undefined, { left: 1, right: 0 });
		expect(device.queue.writeBuffer.mock.calls[1]?.[2]).toEqual(new Float32Array([0, 1, 0, 1]));
	});

	it("clamps backing size and releases the crop buffer", () => {
		const { renderer, canvas, context, rangeBuffer } = setup();
		renderer.resize(16384, 8192);
		expect(canvas).toMatchObject({ width: 8192, height: 4096 });
		renderer.destroy();
		expect(rangeBuffer.destroy).toHaveBeenCalledOnce();
		expect(context.unconfigure).toHaveBeenCalledOnce();
	});
});
