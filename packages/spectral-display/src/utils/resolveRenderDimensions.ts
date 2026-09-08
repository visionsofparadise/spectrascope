import { getMaxFftSize } from "../engine/device";
import type { Dimensions } from "../engine/SpectralEngine";

export function resolveRenderDimensions(dimensions: Dimensions, device: GPUDevice, fftSize: number): Dimensions {
	const { width, height } = dimensions;

	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		throw new Error("Render dimensions must be finite and positive");
	}

	const { maxTextureDimension2D, maxBufferSize, maxStorageBufferBindingSize } = device.limits;
	const bands = Math.min(fftSize, getMaxFftSize(device)) / 2 + 1;
	const maxWidth = Math.min(
		maxTextureDimension2D,
		Math.floor(Math.min(maxBufferSize, maxStorageBufferBindingSize) / (bands * 4)),
	);
	const scale = Math.min(1, maxWidth / width, maxTextureDimension2D / height);

	return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
