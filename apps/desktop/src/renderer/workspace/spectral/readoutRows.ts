import { formatInspectionTime } from "../utils/formatInspectionTime";
import type { TransportReadoutRow } from "../Transport";

export const EMPTY_READOUT = "—";

export function timeReadoutRowOf(
	cursorMs: number | undefined,
	selection: { readonly start: number; readonly end: number } | null,
): TransportReadoutRow {
	return {
		label: "Time",
		cursor: cursorMs === undefined ? EMPTY_READOUT : formatInspectionTime(cursorMs),
		in: selection ? formatInspectionTime(selection.start) : EMPTY_READOUT,
		out: selection ? formatInspectionTime(selection.end) : EMPTY_READOUT,
	};
}
