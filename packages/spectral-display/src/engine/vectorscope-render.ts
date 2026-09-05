import { VECTORSCOPE_VISUALIZE_SHADER } from "./shaders";

/**
 * Renders the whole-clip vectorscope histogram to an `rgba8unorm` GPU texture.
 *
 * A small, self-contained GPU render path — deliberately not part of
 * `SpectralEngine`, which is FFT-specific. Each source's density cloud renders
 * as a single-hue cloud in that source's tint color on a transparent
 * background (premultiplied alpha), so stacked vectorscope canvases composite
 * cleanly. The resulting texture is blitted to a canvas by `BlitRenderer`,
 * exactly as the spectrogram and waveform textures are.
 */
export class VectorscopeRenderer {
	private readonly device: GPUDevice;
	private readonly pipeline: GPUComputePipeline;

	private histogramBuffer: GPUBuffer | null = null;
	private histogramByteLength = 0;
	private outputTexture: GPUTexture | null = null;
	private outputWidth = 0;
	private outputHeight = 0;

	constructor(device: GPUDevice) {
		this.device = device;

		const shaderModule = device.createShaderModule({ code: VECTORSCOPE_VISUALIZE_SHADER });

		this.pipeline = device.createComputePipeline({
			layout: "auto",
			compute: {
				module: shaderModule,
				entryPoint: "main",
			},
		});
	}

	/**
	 * Dispatches the visualize shader over `histogram` and returns the produced
	 * texture. The renderer owns the texture's lifetime — callers must not
	 * destroy it; the previous texture is destroyed when `render` is next called
	 * or on `destroy`.
	 *
	 * @param histogram a square `gridSize * gridSize` density grid.
	 * @param tint the cloud's RGB color, each component a 0–255 integer.
	 */
	render(
		histogram: Uint32Array,
		gridSize: number,
		width: number,
		height: number,
		tint: readonly [number, number, number],
	): GPUTexture {
		// (Re)allocate the storage buffer when the histogram size changes.
		if (!this.histogramBuffer || this.histogramByteLength !== histogram.byteLength) {
			this.histogramBuffer?.destroy();
			this.histogramBuffer = this.device.createBuffer({
				size: histogram.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			});
			this.histogramByteLength = histogram.byteLength;
		}

		this.device.queue.writeBuffer(
			this.histogramBuffer,
			0,
			histogram.buffer,
			histogram.byteOffset,
			histogram.byteLength,
		);

		// (Re)allocate the output texture when the dimensions change.
		if (!this.outputTexture || this.outputWidth !== width || this.outputHeight !== height) {
			this.outputTexture?.destroy();
			this.outputTexture = this.device.createTexture({
				size: { width, height },
				format: "rgba8unorm",
				usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
			});
			this.outputWidth = width;
			this.outputHeight = height;
		}

		let maxCount = 0;

		for (let index = 0; index < histogram.length; index++) {
			const count = histogram[index]!;

			if (count > maxCount) maxCount = count;
		}

		// Uniform layout (8 x 4 bytes): grid_size, output_width, output_height,
		// max_count (u32) then tint_r, tint_g, tint_b, _pad (f32).
		const uniformData = new ArrayBuffer(32);
		const uniformU32 = new Uint32Array(uniformData, 0, 4);
		const uniformF32 = new Float32Array(uniformData, 16, 4);

		uniformU32[0] = gridSize;
		uniformU32[1] = width;
		uniformU32[2] = height;
		uniformU32[3] = maxCount;
		uniformF32[0] = tint[0];
		uniformF32[1] = tint[1];
		uniformF32[2] = tint[2];
		uniformF32[3] = 0;

		const uniformBuffer = this.device.createBuffer({
			size: uniformData.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});

		new Uint8Array(uniformBuffer.getMappedRange()).set(new Uint8Array(uniformData));
		uniformBuffer.unmap();

		const bindGroup = this.device.createBindGroup({
			layout: this.pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: this.histogramBuffer } },
				{ binding: 1, resource: this.outputTexture.createView() },
				{ binding: 2, resource: { buffer: uniformBuffer } },
			],
		});

		const commandEncoder = this.device.createCommandEncoder();
		const computePass = commandEncoder.beginComputePass();

		computePass.setPipeline(this.pipeline);
		computePass.setBindGroup(0, bindGroup);
		computePass.dispatchWorkgroups(Math.ceil(width / 64), height);
		computePass.end();

		this.device.queue.submit([commandEncoder.finish()]);

		uniformBuffer.destroy();

		return this.outputTexture;
	}

	destroy(): void {
		this.histogramBuffer?.destroy();
		this.histogramBuffer = null;
		this.outputTexture?.destroy();
		this.outputTexture = null;
	}
}
