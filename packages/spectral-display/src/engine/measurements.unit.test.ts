import { describe, expect, it, vi } from "vitest";
import { analyzeMeasurements, selectMeasurements } from "./measurements";
import { computeLoudnessData, meanSquareToLufs } from "./loudness";
import { createScanContext, finalizeScan, scanSamples } from "./sample-scan";
import type { MeasurementData } from "./measurements";

function measurements(energies: ReadonlyArray<number>): MeasurementData {
	const values = new Float32Array(energies);
	return {
		metadata: { sampleRate: 1000, sampleCount: values.length * 2, channelCount: 2 },
		samplesPerPoint: 2,
		rms: values.map(Math.sqrt),
		peaks: values.map(Math.sqrt),
		truePeaks: values.map(Math.sqrt),
		weightedEnergy: values,
		momentaryLufs: values.map(meanSquareToLufs),
		shortTermLufs: values.map(meanSquareToLufs),
		leftEnergy: values.slice(),
		rightEnergy: values.slice(),
		crossEnergy: values.slice(),
		vectorscopeHistogram: new Uint32Array(256 * 256),
	};
}

describe("session measurements", () => {
	it.each([[1], [1, 1], [1, -1], [1, 0.25]])(
		"preserves direct signal and full-scan statistics for channel gains %s",
		async (...gains) => {
			const channels = gains.map((gain) =>
				Float32Array.from({ length: 24003 }, (_, index) => gain * 0.7 * Math.sin(index * 0.17)),
			);
			const metadata = { sampleRate: 48000, sampleCount: channels[0]!.length, channelCount: channels.length };
			const data = await analyzeMeasurements(
				metadata,
				async (channel, offset, count) => channels[channel]!.slice(offset, offset + count),
				new AbortController().signal,
				() => {},
			);
			const context = createScanContext(
				metadata,
				Math.ceil(metadata.sampleCount / data.samplesPerPoint),
				data.samplesPerPoint,
				metadata.sampleCount,
				true,
				true,
				true,
			);
			scanSamples(channels, metadata.sampleCount, context);
			const full = finalizeScan(context);
			const previous = computeLoudnessData(context, full.overallPeak, full.overallRms, full.truePeak);
			const whole = selectMeasurements(data, 0, metadata.sampleCount).loudnessData;
			for (const key of ["peakDb", "rmsDb", "crestFactor", "truePeak", "integratedLufs"] as const) {
				if (Number.isFinite(previous[key])) expect(whole[key]).toBeCloseTo(previous[key]!, 5);
				else expect(whole[key]).toBe(previous[key]);
			}
			const selected = selectMeasurements(data, 101, 999);
			let sum = 0;
			let peak = 0;
			for (let index = selected.startSample; index < selected.endSample; index++) {
				const sample = channels.reduce((value, channel) => value + channel[index]!, 0) / channels.length;
				sum += sample * sample;
				peak = Math.max(peak, Math.abs(sample));
			}
			const rms = Math.sqrt(sum / (selected.endSample - selected.startSample));
			expect(selected.loudnessData.peakDb).toBeCloseTo(peak > 0 ? 20 * Math.log10(peak) : -Infinity, 5);
			expect(selected.loudnessData.rmsDb).toBeCloseTo(rms > 0 ? 20 * Math.log10(rms) : -Infinity, 5);
			if (gains.length === 2 && gains[1] === -1) {
				expect(whole.truePeak).toBeGreaterThan(0.69);
				expect([...selectMeasurements(data, 0, metadata.sampleCount).correlationEnvelope]).toEqual(
					new Array(data.rms.length).fill(-1),
				);
			}
		},
	);
	it("recomputes absolute and relative gates for the selected energy blocks", () => {
		const data = measurements([...new Array<number>(500).fill(1), ...new Array<number>(500).fill(0.0001)]);
		const whole = selectMeasurements(data, 0, 2000);
		const quiet = selectMeasurements(data, 1000, 2000);
		expect(quiet.loudnessData.integratedLufs).toBeCloseTo(meanSquareToLufs(0.0001), 4);
		expect(whole.loudnessData.integratedLufs).toBeGreaterThan(quiet.loudnessData.integratedLufs + 30);
	});

	it("returns complete source bins, clips padding, and keeps exact final coverage", () => {
		const base = measurements([1, 4, 9]);
		const data = { ...base, metadata: { ...base.metadata, sampleCount: 5 } };
		expect(selectMeasurements(data, 2.9, 3.1)).toMatchObject({ startSample: 2, endSample: 4 });
		expect(selectMeasurements(data, -100, 100)).toMatchObject({ startSample: 0, endSample: 5 });
		expect(selectMeasurements(data, 20, 21)).toMatchObject({ startSample: 5, endSample: 5 });
		expect(selectMeasurements(data, -20, -1)).toMatchObject({ startSample: 0, endSample: 0 });
		expect(selectMeasurements(data, 0, 5).loudnessData.rmsDb).toBeCloseTo(10 * Math.log10(19 / 5), 5);
	});

	it("retains continuous source traces while selecting window peaks and cross moments", () => {
		const data = measurements([1, 4, 9]);
		data.truePeaks[0] = 8;
		data.truePeaks[1] = 2;
		data.crossEnergy[1] = -4;
		const selected = selectMeasurements(data, 2, 4);
		expect(selected.loudnessData.truePeak).toBe(2);
		expect(selected.correlationEnvelope[0]).toBe(-1);
		expect(selected.loudnessData.momentaryLufs[0]).toBe(data.momentaryLufs[1]);
	});

	it("reads each channel once per chunk and retains per-bin true peaks across channel passes", async () => {
		const samples = new Float32Array(65539);
		samples[1] = 0.8;
		samples[65538] = 0.4;
		const read = vi.fn((channel: number, offset: number, count: number) =>
			Promise.resolve(channel === 0 ? samples.slice(offset, offset + count) : new Float32Array(count)),
		);
		const data = await analyzeMeasurements(
			{ sampleRate: 48000, sampleCount: samples.length, channelCount: 2 },
			read,
			new AbortController().signal,
			() => {},
		);
		expect(read).toHaveBeenCalledTimes(4);
		expect(data.truePeaks[0]).toBeGreaterThan(0.7);
		expect(data.truePeaks[1]).toBe(0);
		expect(data.truePeaks[data.truePeaks.length - 1]).toBeGreaterThan(0.3);
		const selected = selectMeasurements(data, 65536, samples.length);
		expect(selected.endSample).toBe(samples.length);
		expect(selected.loudnessData.truePeak).toBeLessThan(0.7);
		expect(read).toHaveBeenCalledTimes(4);
	});

	it("rejects aborted and incomplete scans instead of publishing a partial result", async () => {
		const controller = new AbortController();
		controller.abort();
		const read = vi.fn(() => Promise.resolve(new Float32Array(1)));
		const metadata = { sampleRate: 48000, sampleCount: 10, channelCount: 1 };
		await expect(analyzeMeasurements(metadata, read, controller.signal, () => {})).rejects.toThrow();
		expect(read).not.toHaveBeenCalled();
		await expect(analyzeMeasurements(metadata, read, new AbortController().signal, () => {})).rejects.toThrow(
			"Incomplete",
		);
	});
});
