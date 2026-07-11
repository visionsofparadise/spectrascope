import { describe, expect, it } from "vitest";
import { lavaColormap } from "../utils/lava";
import { computeColumnRange, computeHopSize, computeNumBands, resolveConfig } from "./SpectralEngine";

// f32 replica of the SPECTROGRAM_VISUALIZE_SHADER / SPECTROGRAM_FOLD_SHADER column partition.
// stride = f32(total_frames) / f32(num_columns); frame_start = u32(f32(column) * stride);
// frame_end = min(u32(f32(column + 1) * stride), total_frames). Math.fround models the f32 rounding.
function partitionStride(totalFrames: number, width: number): number {
	return Math.fround(Math.fround(totalFrames) / Math.fround(width));
}

function frameStart(column: number, totalFrames: number, width: number): number {
	return Math.trunc(Math.fround(Math.fround(column) * partitionStride(totalFrames, width)));
}

function frameEnd(column: number, totalFrames: number, width: number): number {
	return Math.min(Math.trunc(Math.fround(Math.fround(column + 1) * partitionStride(totalFrames, width))), totalFrames);
}

const mockDevice = {} as GPUDevice;
const mockSignal = new AbortController().signal;

describe("resolveConfig", () => {
	it("returns all defaults when only device and signal provided", () => {
		const result = resolveConfig({ device: mockDevice, signal: mockSignal });

		expect(result.fftSize).toBe(4096);
		expect(result.frequencyScale).toBe("log");
		expect(result.dbRange).toEqual([-120, 0]);
		expect(result.colormap).toEqual(lavaColormap);
		expect(result.waveformColor).toEqual([40, 135, 180]);
		expect(result.device).toBe(mockDevice);
		expect(result.signal).toBe(mockSignal);
	});

	it("uses provided values and defaults the rest for partial options", () => {
		const result = resolveConfig({
			device: mockDevice,
			signal: mockSignal,
			fftSize: 2048,
			dbRange: [-80, -10],
		});

		expect(result.fftSize).toBe(2048);
		expect(result.dbRange).toEqual([-80, -10]);
		expect(result.frequencyScale).toBe("log");
		expect(result.colormap).toEqual(lavaColormap);
		expect(result.waveformColor).toEqual([40, 135, 180]);
	});

	it("uses all provided values when full options given", () => {
		const customColormap = {
			colors: [
				{ position: 0, color: [0, 0, 0] as const },
				{ position: 1, color: [255, 255, 255] as const },
			],
		};

		const result = resolveConfig({
			device: mockDevice,
			signal: mockSignal,
			fftSize: 8192,
			frequencyScale: "mel",
			dbRange: [-90, -5],
			colormap: customColormap,
			waveformColor: [255, 0, 0],
		});

		expect(result.fftSize).toBe(8192);
		expect(result.frequencyScale).toBe("mel");
		expect(result.dbRange).toEqual([-90, -5]);
		expect(result.colormap).toEqual(customColormap);
		expect(result.waveformColor).toEqual([255, 0, 0]);
	});
});

describe("computeHopSize", () => {
	it("returns the floor hop when zoomed in", () => {
		expect(computeHopSize(100_000, 2000, 4096, 16)).toBe(256);
	});

	it("returns the cap hop when zoomed out", () => {
		expect(computeHopSize(100_000_000, 2000, 4096, 16)).toBe(2048);
	});

	it("returns the display-derived target between floor and cap", () => {
		expect(computeHopSize(4_000_000, 2000, 4096, 16)).toBe(1000);
	});

	it("pins to fftSize when hopOverlap is 1 (floor above the /2 cap wins)", () => {
		expect(computeHopSize(4_000_000, 2000, 4096, 1)).toBe(4096);
	});

	it("never returns below 1", () => {
		expect(computeHopSize(10, 2000, 8, 1000)).toBe(1);
	});
});

describe("computeNumBands", () => {
	it("returns the bin cap for linear scale", () => {
		expect(computeNumBands(500, 4096, true, true)).toBe(2049);
	});

	it("returns the bin cap for LTAS-only (non-linear, spectrogram false)", () => {
		expect(computeNumBands(500, 4096, false, false)).toBe(2049);
	});

	it("derives from height in the middle regime", () => {
		expect(computeNumBands(500, 4096, false, true)).toBe(1000);
	});

	it("clamps up to 64 for a tiny height", () => {
		expect(computeNumBands(10, 4096, false, true)).toBe(64);
	});

	it("clamps down to the bin cap for a tall view", () => {
		expect(computeNumBands(5000, 4096, false, true)).toBe(2049);
	});
});

describe("spectrogram column partition", () => {
	// width = 1, totalFrames = width + 1 (3/2, 5/4, 1001/1000), and large (~1e6 frames, 2000 columns).
	const cases: Array<[number, number]> = [
		[2, 1],
		[3, 2],
		[5, 4],
		[1001, 1000],
		[262144, 2000],
		[1000000, 2000],
		[999983, 1999],
	];

	it("assigns every frame index to exactly one column", () => {
		for (const [totalFrames, width] of cases) {
			const owner = new Int32Array(totalFrames).fill(-1);
			let doubleClaimed = -1;

			for (let column = 0; column < width && doubleClaimed === -1; column++) {
				const start = frameStart(column, totalFrames, width);
				const end = frameEnd(column, totalFrames, width);

				for (let frame = start; frame < end; frame++) {
					if (owner[frame] !== -1) {
						doubleClaimed = frame;
						break;
					}

					owner[frame] = column;
				}
			}

			let uncovered = -1;

			for (let frame = 0; frame < totalFrames; frame++) {
				if (owner[frame] === -1) {
					uncovered = frame;
					break;
				}
			}

			expect(doubleClaimed, `frame ${doubleClaimed} claimed twice at ${totalFrames}/${width}`).toBe(-1);
			expect(uncovered, `frame ${uncovered} uncovered at ${totalFrames}/${width}`).toBe(-1);
		}
	});
});

describe("computeColumnRange", () => {
	it("returns a superset of every column a batch's frames touch", () => {
		const scenarios: Array<[number, number, number, number]> = [
			[1000000, 2000, 0, 64],
			[1000000, 2000, 500000, 64],
			[1000000, 2000, 999900, 100],
			[262144, 2000, 131000, 131],
			[131073, 131072, 0, 1000],
			[999983, 1999, 12345, 500],
		];

		for (const [totalFrames, width, batchBase, batchFrames] of scenarios) {
			const { colFirst, colLast } = computeColumnRange(batchBase, batchFrames, totalFrames, width);
			const batchEnd = batchBase + batchFrames;
			let missed = -1;

			for (let column = 0; column < width && missed === -1; column++) {
				const start = Math.max(frameStart(column, totalFrames, width), batchBase);
				const end = Math.min(frameEnd(column, totalFrames, width), batchEnd);

				if (start < end && (column < colFirst || column > colLast)) {
					missed = column;
				}
			}

			expect(missed, `touched column ${missed} outside [${colFirst}, ${colLast}] at ${totalFrames}/${width} base ${batchBase}`).toBe(-1);
		}
	});

	it("clamps to valid column bounds at the window edges", () => {
		expect(computeColumnRange(0, 64, 1000000, 2000).colFirst).toBe(0);
		expect(computeColumnRange(999900, 100, 1000000, 2000).colLast).toBe(1999);
	});
});
