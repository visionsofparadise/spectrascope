import { useEffect, useRef } from "react";
import { BlitRenderer } from "./engine/blit";
import { VECTORSCOPE_GRID_SIZE } from "./engine/sample-scan";
import { VectorscopeRenderer } from "./engine/vectorscope-render";
import { useCanvasRef } from "./useCanvasRef";
import type { ComputeResult } from "./useSpectralCompute";

export interface VectorscopeCanvasProps {
	computeResult: ComputeResult;
	ref?: React.Ref<HTMLCanvasElement>;
	/**
	 * The density cloud's tint color, as an `[r, g, b]` triple of 0–255
	 * integers. Matches `WaveformCanvas`'s `color` prop convention. The whole
	 * cloud renders in this single hue on a transparent background, so stacked
	 * `VectorscopeCanvas`es composite cleanly.
	 */
	tint: [number, number, number];
	/** Render canvas at this multiple of the histogram grid resolution (default 1). */
	canvasScale?: number;
}

/**
 * Renders the whole-clip vectorscope histogram (a `(Side, Mid)` density grid)
 * as a single-hue tinted density cloud on a transparent background. Mirrors
 * `SpectrogramCanvas`: a `VectorscopeRenderer` dispatches the visualize compute
 * shader to a texture, which `BlitRenderer` blits to the canvas. Requires a
 * `"ready"` `ComputeResult` with a non-null `vectorscopeHistogram` (produced
 * when `stereo: true`).
 */
export const VectorscopeCanvas: React.FC<VectorscopeCanvasProps> = ({ computeResult, ref, tint, canvasScale = 1 }) => {
	const [internalCanvasReference, canvasCallback] = useCanvasRef(ref);
	const blitReference = useRef<BlitRenderer | null>(null);
	const rendererReference = useRef<VectorscopeRenderer | null>(null);
	const deviceReference = useRef<GPUDevice | null>(null);

	useEffect(() => {
		const canvas = internalCanvasReference.current;

		if (!canvas || computeResult.status !== "ready" || !computeResult.vectorscopeHistogram) {
			return;
		}

		const { device } = computeResult.options.config;
		const { vectorscopeHistogram } = computeResult;
		const size = Math.round(VECTORSCOPE_GRID_SIZE * canvasScale);

		// Rebuild GPU resources when the device changes.
		if (deviceReference.current !== device) {
			blitReference.current?.destroy();
			blitReference.current = null;
			rendererReference.current?.destroy();
			rendererReference.current = null;
		}

		blitReference.current ??= new BlitRenderer(device, canvas);
		rendererReference.current ??= new VectorscopeRenderer(device);
		deviceReference.current = device;

		const texture = rendererReference.current.render(vectorscopeHistogram, VECTORSCOPE_GRID_SIZE, size, size, tint);

		blitReference.current.resize(size, size);
		blitReference.current.render(texture);
	}, [computeResult, tint[0], tint[1], tint[2], canvasScale]);

	useEffect(
		() => () => {
			blitReference.current?.destroy();
			blitReference.current = null;
			rendererReference.current?.destroy();
			rendererReference.current = null;
		},
		[],
	);

	const size = Math.round(VECTORSCOPE_GRID_SIZE * canvasScale);

	return <canvas ref={canvasCallback} width={size} height={size} />;
};
