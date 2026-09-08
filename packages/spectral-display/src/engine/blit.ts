import { BLIT_FRAGMENT_SHADER, BLIT_VERTEX_SHADER } from "./shaders";

export interface TextureVerticalRange {
	readonly top: number;
	readonly bottom: number;
}

export class BlitRenderer {
	private readonly device: GPUDevice;
	private readonly context: GPUCanvasContext;
	private readonly pipeline: GPURenderPipeline;
	private readonly sampler: GPUSampler;
	private readonly rangeBuffer: GPUBuffer;
	private canvasFormat: GPUTextureFormat;

	constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
		this.device = device;

		const context = canvas.getContext("webgpu");

		if (!context) {
			throw new Error("Failed to get WebGPU canvas context");
		}

		this.context = context;
		this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();

		this.context.configure({
			device: this.device,
			format: this.canvasFormat,
			alphaMode: "premultiplied",
		});

		this.sampler = device.createSampler({
			magFilter: "linear",
			minFilter: "linear",
		});

		const vertexModule = device.createShaderModule({ code: BLIT_VERTEX_SHADER });
		const fragmentModule = device.createShaderModule({ code: BLIT_FRAGMENT_SHADER });

		this.pipeline = device.createRenderPipeline({
			layout: "auto",
			vertex: {
				module: vertexModule,
				entryPoint: "main",
			},
			fragment: {
				module: fragmentModule,
				entryPoint: "main",
				targets: [{ format: this.canvasFormat }],
			},
			primitive: {
				topology: "triangle-list",
			},
		});
		this.rangeBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	}

	render(texture: GPUTexture, range?: TextureVerticalRange): void {
		const top = Math.max(0, Math.min(1, range?.top ?? 0));
		const bottom = Math.max(0, Math.min(1, range?.bottom ?? 1));
		const valid = Number.isFinite(range?.top ?? 0) && Number.isFinite(range?.bottom ?? 1) && bottom > top;

		this.device.queue.writeBuffer(this.rangeBuffer, 0, new Float32Array([valid ? top : 0, valid ? bottom : 1, 0, 0]));

		const textureView = texture.createView();

		const bindGroup = this.device.createBindGroup({
			layout: this.pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: textureView },
				{ binding: 1, resource: this.sampler },
				{ binding: 2, resource: { buffer: this.rangeBuffer } },
			],
		});

		const commandEncoder = this.device.createCommandEncoder();

		const renderPass = commandEncoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.context.getCurrentTexture().createView(),
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
					loadOp: "clear" as const,
					storeOp: "store" as const,
				},
			],
		});

		renderPass.setPipeline(this.pipeline);
		renderPass.setBindGroup(0, bindGroup);
		renderPass.draw(6);
		renderPass.end();

		this.device.queue.submit([commandEncoder.finish()]);
	}

	resize(width: number, height: number): void {
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
			throw new Error("Invalid canvas dimensions");
		}

		const canvas = this.context.canvas as HTMLCanvasElement;
		const maximum = this.device.limits.maxTextureDimension2D;
		const scale = Math.min(1, maximum / width, maximum / height);
		const canvasWidth = Math.max(1, Math.floor(width * scale));
		const canvasHeight = Math.max(1, Math.floor(height * scale));

		if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) throw new Error("Invalid canvas dimensions");

		if (canvas.width === canvasWidth && canvas.height === canvasHeight) return;

		canvas.width = canvasWidth;
		canvas.height = canvasHeight;

		this.context.configure({
			device: this.device,
			format: this.canvasFormat,
			alphaMode: "premultiplied",
		});
	}

	destroy(): void {
		this.rangeBuffer.destroy();
		this.context.unconfigure();
	}
}
