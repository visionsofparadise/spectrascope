import { useMemo } from "react";
import { normalizedSelectionOf } from "../utils/selection";
import type { SessionContext } from "../../models/Context";

export function useSessionSelection(context: SessionContext) {
	const { session, sessionDurationMs } = context;
	const selection = session.document.selection;

	return useMemo(() => normalizedSelectionOf(selection, sessionDurationMs), [selection, sessionDurationMs]);
}
