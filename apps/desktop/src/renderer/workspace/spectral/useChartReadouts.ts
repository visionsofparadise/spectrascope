import { useCallback, useMemo, useState } from "react";
import { useWorkspacePlayback } from "../playback";
import { readChartValue } from "../utils/readChartValue";
import { EMPTY_READOUT, timeReadoutRowOf } from "./readoutRows";
import type { TimeWindow } from "../useTimeViewport";

export interface ChartReadoutTrace {
	readonly sourceId: string;
	readonly query: TimeWindow;
	readonly values: Float32Array | number;
	readonly valueToY: (value: number) => number;
	readonly formatValue: (value: number) => string;
}

export function nearestChartTrace(
	traces: ReadonlyMap<string, ChartReadoutTrace>,
	timeMs: number,
	y: number,
): ChartReadoutTrace | undefined {
	let nearest: ChartReadoutTrace | undefined;
	let distance = Infinity;

	for (const trace of traces.values()) {
		const value = readChartValue(trace.values, trace.query, timeMs);

		if (value === null) continue;

		const difference = Math.abs(trace.valueToY(value) - y);

		if (difference < distance) {
			nearest = trace;
			distance = difference;
		}
	}

	return nearest;
}

export function useChartReadouts(valueLabel: string) {
	const { selection } = useWorkspacePlayback();
	const [traces, setTraces] = useState<ReadonlyMap<string, ChartReadoutTrace>>(() => new Map());
	const [cursor, setCursor] = useState<{ timeMs: number; y: number } | null>(null);
	const onTraceChange = useCallback((sourceId: string, trace: ChartReadoutTrace | null) => {
		setTraces((previous) => {
			if (previous.get(sourceId) === trace || (!trace && !previous.has(sourceId))) return previous;

			const next = new Map(previous);

			if (trace) next.set(sourceId, trace);
			else next.delete(sourceId);

			return next;
		});
	}, []);
	const active = cursor ? nearestChartTrace(traces, cursor.timeMs, cursor.y) : traces.values().next().value;
	const control = useMemo(() => {
		const label = (timeMs: number | undefined) => {
			if (!active || timeMs === undefined) return EMPTY_READOUT;

			const value = readChartValue(active.values, active.query, timeMs);

			return value === null ? EMPTY_READOUT : active.formatValue(value);
		};

		return {
			readoutRows: [
				timeReadoutRowOf(cursor?.timeMs, selection),
				{
					label: valueLabel,
					cursor: label(cursor?.timeMs),
					in: label(selection?.start),
					out: label(selection?.end),
				},
			],
		};
	}, [active, cursor, selection, valueLabel]);

	return { control, setCursor, onTraceChange };
}
