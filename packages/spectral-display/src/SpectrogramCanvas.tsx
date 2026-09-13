import { useEffect, useRef } from "react";
import { BlitRenderer, type TextureVerticalRange } from "./engine/blit";
import { useCanvasRef } from "./useCanvasRef";
import { resolveRenderDimensions } from "./utils/resolveRenderDimensions";
import { retainTexture } from "./utils/textureOwnership";
import type { ComputeResult } from "./useSpectralCompute";

interface SpectrogramCanvasProps {
	computeResult: ComputeResult;
	ref?: React.Ref<HTMLCanvasElement>;
	canvasScale?: number;
	frequencyRange?: TextureVerticalRange;
	onRendered?: () => void;
}

export const SpectrogramCanvas: React.FC<SpectrogramCanvasProps> = ({
	computeResult,
	ref,
	canvasScale = 1,
	frequencyRange,
	onRendered,
}) => {
	const [internalCanvasReference, canvasCallback] = useCanvasRef(ref);
	const blitReference = useRef<BlitRenderer | null>(null);
	const blitDeviceRef = useRef<GPUDevice | null>(null);
	const onRenderedRef = useRef(onRendered);

	onRenderedRef.current = onRendered;

	const scale = Number.isFinite(canvasScale) && canvasScale > 0 ? canvasScale : 1;
	const dimensions =
		computeResult.status === "ready"
			? resolveRenderDimensions(
					{
						width: computeResult.options.sampleQuery.width * scale,
						height: computeResult.options.sampleQuery.height * scale,
					},
					computeResult.options.config.device,
					computeResult.options.config.fftSize,
				)
			: { width: 0, height: 0 };
	const { width: canvasWidth, height: canvasHeight } = dimensions;

	useEffect(() => {
		const canvas = internalCanvasReference.current;

		if (!canvas || computeResult.status !== "ready") {
			return;
		}

		if (!computeResult.spectrogramTexture) {
			canvas.width = canvasWidth;
			canvas.height = canvasHeight;
			onRenderedRef.current?.();

			return;
		}

		const { device } = computeResult.options.config;

		if (blitReference.current && blitDeviceRef.current !== device) {
			blitReference.current.destroy();
			blitReference.current = null;
		}

		blitReference.current ??= new BlitRenderer(device, canvas);
		blitDeviceRef.current = device;

		blitReference.current.resize(canvasWidth, canvasHeight);

		const range = computeResult.spectrogramRange;
		const sampleRate = computeResult.options.metadata.sampleRate;
		const span = range ? range.endSample - range.startSample : 0;
		const horizontalRange =
			range && span > 0
				? {
						left: ((computeResult.query.startMs * sampleRate) / 1000 - range.startSample) / span,
						right: ((computeResult.query.endMs * sampleRate) / 1000 - range.startSample) / span,
					}
				: undefined;

		blitReference.current.render(computeResult.spectrogramTexture, frequencyRange, horizontalRange);

		onRenderedRef.current?.();
	}, [computeResult, canvasWidth, canvasHeight, frequencyRange?.top, frequencyRange?.bottom]);

	const texture = computeResult.status === "ready" ? computeResult.spectrogramTexture : null;

	useEffect(() => {
		if (texture) return retainTexture(texture);
	}, [texture]);

	useEffect(
		() => () => {
			blitReference.current?.destroy();
			blitReference.current = null;
		},
		[],
	);

	return <canvas ref={canvasCallback} width={canvasWidth} height={canvasHeight} />;
};
