import { useCallback, useMemo, useSyncExternalStore } from "react";
import { heldComputeResult } from "./computeResult";
import { useMeasurementSession } from "./MeasurementSession";
import type { AudioData } from "./types";
import type { ComputeResult, SpectralOptions } from "spectral-display";

export function useTraceCompute(
	audioData: AudioData,
	startMs: number,
	endMs: number,
	config: SpectralOptions["config"],
	sourceId: string,
	offsetMs = 0,
) {
	const { session, sourceAudio } = useMeasurementSession();
	const source = sourceAudio.get(sourceId) ?? audioData;
	const job = session.job(source, config);
	const subscribe = useCallback(
		(listener: () => void) => {
			job.listeners.add(listener);

			return () => {
				job.listeners.delete(listener);
			};
		},
		[job],
	);
	const snapshot = useCallback(() => job.result, [job]);
	const result = useSyncExternalStore(subscribe, snapshot);
	const computeResult = useMemo<ComputeResult>(() => {
		if (result.status !== "ready" || !job.measurements) return result;

		const selected = session.select(
			job,
			((startMs - offsetMs) * source.sampleRate) / 1000,
			((endMs - offsetMs) * source.sampleRate) / 1000,
		);

		if (!selected || selected.endSample <= selected.startSample) return { status: "idle" };

		return {
			...result,
			loudnessData: selected.loudnessData,
			correlationEnvelope: selected.correlationEnvelope,
			query: {
				...result.query,
				startMs: (selected.startSample / source.sampleRate) * 1000 + offsetMs,
				endMs: (selected.endSample / source.sampleRate) * 1000 + offsetMs,
			},
		};
	}, [result, job, session, startMs, endMs, offsetMs, source.sampleRate]);

	return { computeResult, renderable: heldComputeResult(computeResult) };
}
