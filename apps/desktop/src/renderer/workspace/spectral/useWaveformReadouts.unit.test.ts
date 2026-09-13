import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWaveformReadouts, waveformAmplitudeLabel } from "./useWaveformReadouts";
import type { DisplayedWaveform } from "./useWaveformReadouts";
import type { ComputeResultReady } from "spectral-display";

const runtime = vi.hoisted(() => ({ index: 0, states: [] as Array<unknown> }));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useMemo: (compute: () => unknown) => compute(),
	useState: (initial: unknown) => {
		const index = runtime.index++;
		if (!(index in runtime.states)) runtime.states[index] = typeof initial === "function" ? initial() : initial;
		return [
			runtime.states[index],
			(value: unknown) => {
				runtime.states[index] = typeof value === "function" ? value(runtime.states[index]) : value;
			},
		];
	},
}));
vi.mock("../playback", () => ({ useWorkspacePlayback: () => ({ selection: { start: 2010, end: 2012 } }) }));
beforeEach(() => {
	runtime.index = 0;
	runtime.states = [];
});
function readouts() {
	runtime.index = 0;
	return useWaveformReadouts();
}

const result = {
	status: "ready",
	waveformBuffer: new Float32Array([-0.5, 0.25, -1, 0.75, 0, 0]),
	waveformPointCount: 3,
	waveformSamplesPerPoint: 2,
	options: {
		metadata: { sampleRate: 1000, sampleCount: 20, channelCount: 1 },
		sampleQuery: { startSample: 10, endSample: 15, width: 100, height: 40 },
	},
} as ComputeResultReady;
const displayed: DisplayedWaveform = { result, sourceName: "Placed source", timeOffsetMs: 2000 };
describe("held waveform readout coverage", () => {
	it("registers progressive results and ignores unchanged waveform publication during spectral updates", () => {
		let view = readouts();
		view.onDisplayedResultChange("tiles", { results: [result], sourceName: "Tiles", timeOffsetMs: 2000 });
		view = readouts();
		const previous = view.displayed;
		view.onDisplayedResultChange("tiles", { results: [result], sourceName: "Tiles", timeOffsetMs: 2000 });
		expect(readouts().displayed).toBe(previous);
	});
	it("reads newly published tiles ahead of old overlapping coverage and keeps gaps unavailable", () => {
		const replacement = { ...result, waveformBuffer: new Float32Array([-0.25, 0.25, -0.25, 0.25, 0, 0]) };
		const tiles: DisplayedWaveform = { results: [result, replacement], sourceName: "Tiles", timeOffsetMs: 2000 };
		expect(waveformAmplitudeLabel(tiles, 2010)).toBe("-12.0");
		expect(waveformAmplitudeLabel(tiles, 2015)).toBeUndefined();
		expect(waveformAmplitudeLabel(tiles, 2012, true)).toBe("-12.0");
		expect(waveformAmplitudeLabel({ results: [], sourceName: "Empty", timeOffsetMs: 0 }, 2010)).toBeUndefined();
	});
	it("tracks named displayed identity through hover, swap and removal", () => {
		let view = readouts();
		view.onDisplayedResultChange("source", displayed);
		view.setCursorReadout({ sourceId: "source", timeMs: 2010, frequencyHz: 1000, time: "", freq: "1 kHz", amp: "—" });
		view = readouts();
		expect(view.control).toMatchObject({
			readoutSourceName: "Placed source",
			selectionInAmp: "-6.0",
			selectionOutAmp: "-6.0",
			cursorReadout: { amp: "-6.0" },
		});
		view.onDisplayedResultChange("source", {
			...displayed,
			sourceName: "Replacement",
			result: { ...result, waveformBuffer: new Float32Array([-0.25, 0.25, -1, 0.75, 0, 0]) },
		});
		view = readouts();
		expect(view.control.readoutSourceName).toBe("Replacement");
		expect(view.control.cursorReadout?.amp).toBe("-12.0");
		view.onDisplayedResultChange("source", null);
		view = readouts();
		expect(view.control.cursorReadout?.amp).toBe("—");
		expect(view.control.selectionInAmp).toBeUndefined();
	});
	it("reads the selected source envelope peak at placed timeline time", () => {
		expect(waveformAmplitudeLabel(displayed, 2010)).toBe("-6.0");
		expect(waveformAmplitudeLabel(displayed, 2012)).toBe("0.0");
	});
	it("measures silence and the last partial bucket", () => {
		expect(waveformAmplitudeLabel(displayed, 2014)).toBe("−∞");
	});
	it("keeps uncovered and unready values unavailable", () => {
		expect(waveformAmplitudeLabel(displayed, 2009)).toBeUndefined();
		expect(waveformAmplitudeLabel(displayed, 2015)).toBeUndefined();
		expect(waveformAmplitudeLabel(undefined, 2010)).toBeUndefined();
	});
	it("reads selection Out from the last included sample", () => {
		expect(waveformAmplitudeLabel(displayed, 2012, true)).toBe("-6.0");
		expect(waveformAmplitudeLabel(displayed, 2015, true)).toBe("−∞");
	});
	it("keeps 44.1 kHz exclusive sample boundaries inside the selection", () => {
		const exact: DisplayedWaveform = {
			...displayed,
			timeOffsetMs: 0,
			result: {
				...result,
				waveformBuffer: new Float32Array([0, 0, 0, 0, -0.5, 0.5, -1, 1]),
				waveformPointCount: 4,
				waveformSamplesPerPoint: 1,
				options: {
					...result.options,
					metadata: { sampleRate: 44100, sampleCount: 4, channelCount: 1 },
					sampleQuery: { startSample: 0, endSample: 4, width: 100, height: 40 },
				},
			},
		};
		expect(waveformAmplitudeLabel(exact, (3 * 1000) / 44100, true)).toBe("-6.0");
		expect(waveformAmplitudeLabel({ ...exact, timeOffsetMs: 3600000 }, 3600000 + (3 * 1000) / 44100, true)).toBe(
			"-6.0",
		);
	});
});
