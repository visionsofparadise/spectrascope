import { useCallback, useMemo, useState } from "react";
import { readWaveformAmplitude } from "spectral-display";
import { useWorkspacePlayback } from "../playback";
import { formatInspectionTime } from "../utils/formatInspectionTime";
import type { SourceRenderCursorReadout } from "../SourceRender";
import type { ComputeResultReady } from "spectral-display";

export type DisplayedWaveform = (
	| { readonly result: ComputeResultReady; readonly results?: never }
	| { readonly results: ReadonlyArray<ComputeResultReady>; readonly result?: never }
) & {
	readonly sourceName: string;
	readonly timeOffsetMs: number;
};

export function waveformAmplitudeLabel(
	displayed: DisplayedWaveform | undefined,
	timeMs: number | undefined,
	exclusiveEnd = false,
): string | undefined {
	if (!displayed || timeMs === undefined) return undefined;

	const results = displayed.results ?? [displayed.result];
	const rate = results[0]?.options.metadata.sampleRate;

	if (!rate) return undefined;

	const localTime = timeMs - displayed.timeOffsetMs;
	const coordinate = (localTime * rate) / 1000;
	const nearest = Math.round(coordinate);
	const tolerance =
		Number.EPSILON *
		Math.max(1, Math.abs((timeMs * rate) / 1000), Math.abs((displayed.timeOffsetMs * rate) / 1000)) *
		4;
	const boundary = Math.abs(coordinate - nearest) <= tolerance ? nearest : coordinate;
	const sampleTime = exclusiveEnd ? ((Math.ceil(boundary) - 0.5) * 1000) / rate : localTime;
	let amplitude: ReturnType<typeof readWaveformAmplitude> = null;

	for (let index = results.length - 1; index >= 0; index -= 1) {
		const result = results[index];

		if (!result) continue;

		amplitude = readWaveformAmplitude(result, sampleTime);

		if (amplitude !== null) break;
	}

	if (!amplitude || !Number.isFinite(amplitude.peak)) return undefined;

	return amplitude.peak === 0 ? "−∞" : (20 * Math.log10(amplitude.peak)).toFixed(1);
}

export function useWaveformReadouts() {
	const { selection } = useWorkspacePlayback();
	const [displayed, setDisplayed] = useState<ReadonlyMap<string, DisplayedWaveform>>(() => new Map());
	const [cursor, setCursor] = useState<SourceRenderCursorReadout | null>(null);
	const onDisplayedResultChange = useCallback((sourceId: string, value: DisplayedWaveform | null) => {
		setDisplayed((previous) => {
			const old = previous.get(sourceId);

			if (
				(!value && !old) ||
				(value &&
					old &&
					old.result === value.result &&
					(old.results === value.results ||
						(old.results?.length === value.results?.length &&
							old.results?.every((result, index) => result === value.results?.[index]))) &&
					old.sourceName === value.sourceName &&
					old.timeOffsetMs === value.timeOffsetMs)
			)
				return previous;

			const next = new Map(previous);

			if (value) next.set(sourceId, value);
			else next.delete(sourceId);

			return next;
		});
	}, []);
	const active = cursor?.sourceId ? displayed.get(cursor.sourceId) : displayed.values().next().value;
	const control = useMemo(
		() => ({
			cursorReadout: cursor
				? {
						time: formatInspectionTime(cursor.timeMs),
						freq: cursor.freq,
						amp: waveformAmplitudeLabel(active, cursor.timeMs) ?? "—",
					}
				: undefined,
			selectionInAmp: waveformAmplitudeLabel(active, selection?.start),
			selectionOutAmp: waveformAmplitudeLabel(active, selection?.end, true),
			readoutSourceName: active?.sourceName,
			amplitudeLabel: "Peak dBFS",
		}),
		[active, cursor, selection],
	);

	return { control, displayed, setCursorReadout: setCursor, onDisplayedResultChange };
}
