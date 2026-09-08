import type { ComputeState } from "./firstComputeProgress";
import type { AudioData } from "./types";
import type { ChartReadoutTrace } from "./useChartReadouts";
import type { Source } from "../source";

export interface ChartTraceProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly startMs: number;
	readonly endMs: number;
	readonly liveStartMs: number;
	readonly liveEndMs: number;
	readonly onComputeState?: (sourceId: string, state: ComputeState | null) => void;
	readonly onTraceChange: (sourceId: string, trace: ChartReadoutTrace | null) => void;
}
