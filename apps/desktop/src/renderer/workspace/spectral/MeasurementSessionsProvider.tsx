import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { initializeStreamQueries, sourceStreamQueryOptions } from "../../audio/utils/streamQueryOptions";
import { MeasurementSessions, MeasurementSessionsContext } from "./MeasurementSession";
import type { SessionSources } from "./MeasurementSession";
import type { AudioData } from "./types";
import type { StreamQueryEntry } from "../../audio/utils/streamQueryOptions";
import type { ReactNode } from "react";

function combineStreams(results: Array<UseQueryResult<StreamQueryEntry>>) {
	return results.map((result) => result.data);
}

export function MeasurementSessionsProvider({
	comparisons,
	activeSessionId,
	children,
}: {
	readonly comparisons: ReadonlyArray<SessionSources>;
	readonly activeSessionId: string | null;
	readonly children: ReactNode;
}) {
	const client = useQueryClient();

	initializeStreamQueries(client);

	const registry = useMemo(() => new MeasurementSessions(), []);
	const paths = useMemo(
		() => registry.sourcePaths(comparisons, activeSessionId),
		[registry, comparisons, activeSessionId],
	);
	const streams = useQueries({
		queries: paths.map((path) => sourceStreamQueryOptions(path, null)),
		combine: combineStreams,
	});
	const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const audioByPath = new Map<string, AudioData>();

		for (const [index, path] of paths.entries()) {
			const entry = streams[index];

			if (entry) audioByPath.set(path, entry.audioData);
		}

		registry.retain(comparisons, audioByPath);
	}, [registry, comparisons, paths, streams]);
	useEffect(() => {
		if (disposeTimer.current !== null) clearTimeout(disposeTimer.current);

		return () => {
			disposeTimer.current = setTimeout(() => registry.dispose(), 0);
		};
	}, [registry]);

	return <MeasurementSessionsContext.Provider value={registry}>{children}</MeasurementSessionsContext.Provider>;
}
