import { createContext, useContext, useMemo } from "react";
import {
	analyzeMeasurements,
	getDevice,
	resolveConfig,
	runPipeline,
	selectMeasurements,
	SpectralEngine,
} from "spectral-display";
import type { AudioData } from "./types";
import type { ReactNode } from "react";
import type { ComputeResult, MeasurementData, SpectralOptions } from "spectral-display";

export interface MeasurementJob {
	result: ComputeResult;
	measurements: MeasurementData | null;
	readonly controller: AbortController;
	readonly listeners: Set<() => void>;
	readonly audioData: AudioData;
	readonly selections: Map<string, ReturnType<typeof selectMeasurements>>;
}

export class MeasurementSession {
	readonly jobs = new Map<AudioData["readSamples"], Map<string, MeasurementJob>>();

	job(audioData: AudioData, config: SpectralOptions["config"]): MeasurementJob {
		const key = JSON.stringify([
			audioData.sampleRate,
			audioData.totalSamples,
			audioData.channels,
			config?.ltas ? ["frequency", config.fftSize, config.hopOverlap, config.channelInput] : "measurements",
		]);
		let sourceJobs = this.jobs.get(audioData.readSamples);

		if (!sourceJobs) {
			sourceJobs = new Map();
			this.jobs.set(audioData.readSamples, sourceJobs);
		}

		const existing = sourceJobs.get(key);

		if (existing) return existing;

		const job: MeasurementJob = {
			result: { status: "computing", fraction: 0, previous: null },
			measurements: null,
			controller: new AbortController(),
			listeners: new Set(),
			audioData,
			selections: new Map(),
		};

		sourceJobs.set(key, job);
		void this.compute(job, config);

		return job;
	}

	select(job: MeasurementJob, startSample: number, endSample: number) {
		if (!job.measurements) return null;

		const { samplesPerPoint } = job.measurements;
		const key = `${Math.floor(startSample / samplesPerPoint)}:${Math.ceil(endSample / samplesPerPoint)}`;
		const existing = job.selections.get(key);

		if (existing) return existing;

		const selected = selectMeasurements(job.measurements, startSample, endSample);

		job.selections.set(key, selected);

		if (job.selections.size > 2) {
			const first = job.selections.keys().next().value;

			if (first !== undefined) job.selections.delete(first);
		}

		return selected;
	}

	retain(audio: ReadonlyMap<string, AudioData>) {
		const readers = new Set(Array.from(audio.values(), (value) => value.readSamples));

		for (const [reader, jobs] of this.jobs) {
			if (readers.has(reader)) continue;

			for (const job of jobs.values()) job.controller.abort();

			this.jobs.delete(reader);
		}
	}

	dispose() {
		for (const jobs of this.jobs.values()) for (const job of jobs.values()) job.controller.abort();

		this.jobs.clear();
	}

	private async compute(job: MeasurementJob, provided: SpectralOptions["config"]) {
		const { audioData, controller } = job;
		const signal = controller.signal;
		const publish = (result: ComputeResult) => {
			if (signal.aborted) return;

			job.result = result;

			for (const listener of job.listeners) listener();
		};
		const onProgress = (fraction: number) => publish({ status: "computing", fraction, previous: null });

		try {
			const metadata = {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			};
			const device = await getDevice();

			signal.throwIfAborted();

			const config = resolveConfig({
				...provided,
				...(provided?.ltas ? {} : { loudness: true, truePeak: true, stereo: true }),
				spectrogram: false,
				device,
				signal,
			});
			const sampleQuery = { startSample: 0, endSample: audioData.totalSamples, width: 64, height: 64 };
			const options = { metadata, sampleQuery, readSamples: audioData.readSamples, config };
			const query = { startMs: 0, endMs: audioData.durationMs, width: 64, height: 64 };

			if (provided?.ltas) {
				const engine = new SpectralEngine(device);

				try {
					const result = await runPipeline({ ...options, onProgress }, engine);

					publish({ ...result, waveformBuffer: null, status: "ready", query });
				} finally {
					engine.destroy();
				}
			} else {
				job.measurements = await analyzeMeasurements(metadata, audioData.readSamples, signal, onProgress);
				publish({
					status: "ready",
					query,
					options,
					waveformBuffer: null,
					waveformPointCount: 0,
					waveformSamplesPerPoint: 0,
					loudnessData: null,
					ltas: null,
					correlationEnvelope: null,
					spectrogramTexture: null,
					vectorscopeHistogram: job.measurements.vectorscopeHistogram,
				});
			}
		} catch (cause) {
			publish({ status: "error", error: cause instanceof Error ? cause : new Error(String(cause)), previous: null });
		}
	}
}

const Context = createContext<{ session: MeasurementSession; sourceAudio: ReadonlyMap<string, AudioData> } | null>(
	null,
);

export interface SessionSources {
	readonly id: string;
	readonly sources: ReadonlyArray<{ readonly id: string; readonly audioFilePath: string }>;
}

export class MeasurementSessions {
	readonly sessions = new Map<string, MeasurementSession>();
	readonly visited = new Set<string>();

	sourcePaths(sessions: ReadonlyArray<SessionSources>, activeSessionId: string | null): Array<string> {
		if (activeSessionId && sessions.some((session) => session.id === activeSessionId))
			this.visited.add(activeSessionId);

		return [
			...new Set(
				sessions
					.filter((session) => this.visited.has(session.id))
					.flatMap((session) => session.sources.map((source) => source.audioFilePath))
					.filter(Boolean),
			),
		];
	}

	get(id: string): MeasurementSession {
		this.visited.add(id);

		let session = this.sessions.get(id);

		if (!session) {
			session = new MeasurementSession();
			this.sessions.set(id, session);
		}

		return session;
	}

	retain(sessions: ReadonlyArray<SessionSources>, audioByPath: ReadonlyMap<string, AudioData>) {
		const active = new Map(sessions.map((session) => [session.id, session]));

		for (const id of this.visited) if (!active.has(id)) this.visited.delete(id);

		for (const [id, session] of this.sessions) {
			const sessionSources = active.get(id);

			if (!sessionSources) {
				session.dispose();
				this.sessions.delete(id);

				continue;
			}

			const sourceAudio = new Map<string, AudioData>();

			for (const source of sessionSources.sources) {
				const audio = audioByPath.get(source.audioFilePath);

				if (audio) sourceAudio.set(source.id, audio);
			}

			session.retain(sourceAudio);
		}
	}

	dispose() {
		for (const session of this.sessions.values()) session.dispose();

		this.sessions.clear();
		this.visited.clear();
	}
}

export const MeasurementSessionsContext = createContext<MeasurementSessions | null>(null);

export function MeasurementSessionProvider({
	sessionId,
	sourceAudio,
	children,
}: {
	readonly sessionId: string;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly children: ReactNode;
}) {
	const registry = useContext(MeasurementSessionsContext);

	if (!registry) throw new Error("Measurement sessions are unavailable");

	const session = registry.get(sessionId);

	const value = useMemo(() => ({ session, sourceAudio }), [session, sourceAudio]);

	return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMeasurementSession() {
	const value = useContext(Context);

	if (!value) throw new Error("Measurement session is unavailable");

	return value;
}
