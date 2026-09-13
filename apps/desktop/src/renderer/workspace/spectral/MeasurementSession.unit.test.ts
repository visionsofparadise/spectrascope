import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeMeasurements, getDevice, resolveConfig, runPipeline } from "spectral-display";
import { MeasurementSession, MeasurementSessions } from "./MeasurementSession";
import type { AudioData } from "./types";
import type { MeasurementData } from "spectral-display";

vi.mock("spectral-display", async (original) => ({
	...(await original<typeof import("spectral-display")>()),
	getDevice: vi.fn(() => Promise.resolve({})),
	analyzeMeasurements: vi.fn(),
	runPipeline: vi.fn(),
	SpectralEngine: class {
		destroy() {}
	},
}));

const audio: AudioData = {
	sampleRate: 48000,
	totalSamples: 48000,
	durationMs: 1000,
	channels: 1,
	readSamples: vi.fn(),
};

function measurements(): MeasurementData {
	return {
		metadata: { sampleRate: 48000, sampleCount: 48000, channelCount: 1 },
		samplesPerPoint: 96,
		rms: new Float32Array(500),
		peaks: new Float32Array(500),
		truePeaks: new Float32Array(500),
		weightedEnergy: new Float32Array(500),
		momentaryLufs: new Float32Array(500),
		shortTermLufs: new Float32Array(500),
		leftEnergy: new Float32Array(500),
		rightEnergy: new Float32Array(500),
		crossEnergy: new Float32Array(500),
		vectorscopeHistogram: new Uint32Array(256 * 256),
	};
}

describe("MeasurementSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(analyzeMeasurements).mockResolvedValue(measurements());
	});

	it("shares in-flight loudness and stereo and retains completed results without listeners", async () => {
		let finish: (data: MeasurementData) => void = () => {};
		vi.mocked(analyzeMeasurements).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const session = new MeasurementSession();
		const job = session.job(audio, { loudness: true });
		expect(session.job(audio, { stereo: true })).toBe(job);
		await vi.waitFor(() => expect(analyzeMeasurements).toHaveBeenCalledTimes(1));
		expect(job.controller.signal.aborted).toBe(false);
		finish(measurements());
		await vi.waitFor(() => expect(job.result.status).toBe("ready"));
		expect(session.job(audio, { loudness: true })).toBe(job);
		expect(analyzeMeasurements).toHaveBeenCalledTimes(1);
		expect(session.select(job, 101, 200)).toBe(session.select(job, 102, 201));
		session.dispose();
	});

	it("cancels a removed source while keeping retained source jobs alive", async () => {
		const session = new MeasurementSession();
		const first = session.job(audio, {});
		const secondAudio = { ...audio, readSamples: vi.fn() };
		const second = session.job(secondAudio, {});
		session.retain(new Map([["second", secondAudio]]));
		expect(first.controller.signal.aborted).toBe(true);
		expect(second.controller.signal.aborted).toBe(false);
		expect(session.jobs.size).toBe(1);
		session.dispose();
		expect(second.controller.signal.aborted).toBe(true);
		await Promise.resolve();
	});

	it("suppresses stale completion after removal even if the worker ignores abort", async () => {
		let finish: (data: MeasurementData) => void = () => {};
		vi.mocked(analyzeMeasurements).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const session = new MeasurementSession();
		const job = session.job(audio, {});
		const listener = vi.fn();
		job.listeners.add(listener);
		await vi.waitFor(() => expect(analyzeMeasurements).toHaveBeenCalledOnce());
		session.retain(new Map());
		finish(measurements());
		await Promise.resolve();
		expect(listener).not.toHaveBeenCalled();
		expect(job.result.status).toBe("computing");
		expect(session.jobs.size).toBe(0);
	});

	it("retains frequency results by signal and FFT settings, independent of presentation", async () => {
		const session = new MeasurementSession();
		vi.mocked(runPipeline).mockImplementation(async (options) => ({
			options: { ...options, config: resolveConfig(options.config) },
			waveformBuffer: new Float32Array(0),
			waveformPointCount: 0,
			waveformSamplesPerPoint: 0,
			loudnessData: null,
			ltas: new Float32Array([1, 2]),
			correlationEnvelope: null,
			vectorscopeHistogram: null,
			spectrogramTexture: null,
		}));
		const first = session.job(audio, { ltas: true, fftSize: 4096, channelInput: "mono" });
		await vi.waitFor(() => expect(first.result.status).toBe("ready"));
		expect(session.job(audio, { ltas: true, fftSize: 4096, channelInput: "mono", colormap: "viridis" })).toBe(first);
		expect(runPipeline).toHaveBeenCalledTimes(1);
		expect(session.job(audio, { ltas: true, fftSize: 2048, channelInput: "mono" })).not.toBe(first);
		expect(session.job(audio, { ltas: true, fftSize: 4096, channelInput: "side" })).not.toBe(first);
		session.dispose();
	});

	it("isolates changed immutable source metadata even when a reader is reused", () => {
		const session = new MeasurementSession();
		expect(session.job({ ...audio, sampleRate: 96000 }, {})).not.toBe(session.job(audio, {}));
		session.dispose();
		expect(getDevice).toHaveBeenCalled();
	});
});

describe("MeasurementSessions", () => {
	const first = { id: "first", sources: [{ id: "source", audioFilePath: "/first.wav" }] };
	const second = { id: "second", sources: [{ id: "source", audioFilePath: "/second.wav" }] };

	it("observes only visited sessions and preserves their readers across tab switches", () => {
		const registry = new MeasurementSessions();
		expect(registry.sourcePaths([first, second], null)).toEqual([]);
		expect(registry.sourcePaths([first, second], "first")).toEqual(["/first.wav"]);
		const firstSession = registry.get("first");
		expect(registry.sourcePaths([first, second], "second")).toEqual(["/first.wav", "/second.wav"]);
		expect(registry.get("second")).not.toBe(firstSession);
		expect(registry.get("first")).toBe(firstSession);
		expect(registry.sourcePaths([second], "second")).toEqual(["/second.wav"]);
		registry.dispose();
	});

	it("retains pending jobs across detach and reattach, then cancels actual closed sessions", async () => {
		const registry = new MeasurementSessions();
		const firstSession = registry.get("first");
		const job = firstSession.job(audio, { loudness: true });
		registry.get("second");
		registry.retain(
			[first, second],
			new Map([
				["/first.wav", audio],
				["/second.wav", audio],
			]),
		);
		expect(job.controller.signal.aborted).toBe(false);
		expect(registry.get("first").job(audio, { stereo: true })).toBe(job);
		registry.retain([second], new Map([["/second.wav", audio]]));
		expect(job.controller.signal.aborted).toBe(true);
		expect(registry.sessions.has("first")).toBe(false);
		expect(registry.visited.has("first")).toBe(false);
		registry.dispose();
		await Promise.resolve();
	});

	it("cancels source replacement or removal while the session is inactive", async () => {
		const registry = new MeasurementSessions();
		const session = registry.get("first");
		const job = session.job(audio, {});
		registry.retain([{ ...first, sources: [{ id: "source", audioFilePath: "/replacement.wav" }] }], new Map());
		expect(job.controller.signal.aborted).toBe(true);
		expect(registry.get("first")).toBe(session);
		registry.dispose();
		await Promise.resolve();
	});
});
