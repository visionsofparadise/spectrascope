import { resolveRenderDimensions } from "./resolveRenderDimensions";
import type { SampleQuery, SpectralMetadata } from "../engine/runPipeline";

export interface DisplayTiles {
	readonly startSample: number;
	readonly endSample: number;
	readonly displayEndSample: number;
	readonly width: number;
	readonly height: number;
	readonly tileWidth: number;
	readonly samplesPerColumn: number;
	readonly tileSamples: number;
	readonly tileStarts: ReadonlyArray<number>;
	readonly waveformSamplesPerPoint: number;
}

export function displayTiles(
	query: SampleQuery,
	metadata: SpectralMetadata,
	device: GPUDevice,
	fftSize: number,
): DisplayTiles | null {
	const dimensions = resolveRenderDimensions(query, device, fftSize);
	const start = Math.max(0, Math.min(metadata.sampleCount, Math.floor(query.startSample)));
	const end = Math.max(start, Math.min(metadata.sampleCount, Math.ceil(query.endSample)));
	const span = end - start;
	const requestedSpan = query.requestedSampleCount ?? span;
	const density = requestedSpan / query.width;

	if (span <= 0 || density < 2 * (1 - 1e-10) || !Number.isFinite(density)) return null;

	const maximumWidth = resolveRenderDimensions(
		{ width: device.limits.maxTextureDimension2D, height: 1 },
		device,
		fftSize,
	).width;
	const tileWidth = 2 ** Math.floor(Math.log2(Math.max(1, Math.min(256, maximumWidth / 2))));
	const maximumTiles = Math.floor(maximumWidth / tileWidth);
	let samplesPerColumn = 2 ** Math.floor(Math.log2(density) + 1e-10);
	let tileSamples = tileWidth * samplesPerColumn;

	while (
		maximumTiles > 1
			? Math.ceil(requestedSpan / tileSamples) + 1 > maximumTiles
			: Math.floor(start / tileSamples) !== Math.floor((end - 1) / tileSamples)
	) {
		samplesPerColumn *= 2;
		tileSamples = tileWidth * samplesPerColumn;
	}

	const startSample = Math.floor(start / tileSamples) * tileSamples;
	const displayEndSample = Math.ceil(end / tileSamples) * tileSamples;
	const count = Math.round((displayEndSample - startSample) / tileSamples);

	return {
		startSample,
		endSample: Math.min(metadata.sampleCount, displayEndSample),
		displayEndSample,
		width: count * tileWidth,
		height: dimensions.height,
		tileWidth,
		samplesPerColumn,
		tileSamples,
		tileStarts: Array.from({ length: count }, (_, index) => startSample + index * tileSamples),
		waveformSamplesPerPoint: samplesPerColumn / 2,
	};
}
