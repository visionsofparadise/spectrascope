import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { initializeStreamQueries, sourceStreamQueryOptions } from "../../audio/utils/streamQueryOptions";
import { MeasurementSessions, MeasurementSessionsContext } from "./MeasurementSession";
import type { SessionSources } from "./MeasurementSession";
import type { AudioData } from "./types";
import type { StreamQueryEntry } from "../../audio/utils/streamQueryOptions";
import type { Session } from "../../models/State/Session";
import type { ReactNode } from "react";

function combineStreams(results: Array<UseQueryResult<StreamQueryEntry>>) {
	return results.map((result) => result.data);
}

export function useMeasuredSessions(sessions: ReadonlyArray<Session>): ReadonlyArray<SessionSources> {
	const sourcesKey = JSON.stringify(
		sessions.map((session) => [
			session.id,
			session.document.sources.map((source) => [source.id, source.audioFilePath]),
		]),
	);

	return useMemo(
		() =>
			sessions.map((session) => ({
				id: session.id,
				sources: session.document.sources.map((source) => ({ id: source.id, audioFilePath: source.audioFilePath })),
			})),
		[sourcesKey],
	);
}

export function MeasurementSessionsProvider({
	sessions,
	activeSessionId,
	children,
}: {
	readonly sessions: ReadonlyArray<SessionSources>;
	readonly activeSessionId: string | null;
	readonly children: ReactNode;
}) {
	const client = useQueryClient();

	initializeStreamQueries(client);

	const registry = useMemo(() => new MeasurementSessions(), []);
	const paths = useMemo(() => registry.sourcePaths(sessions, activeSessionId), [registry, sessions, activeSessionId]);
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

		registry.retain(sessions, audioByPath);
	}, [registry, sessions, paths, streams]);
	useEffect(() => {
		if (disposeTimer.current !== null) clearTimeout(disposeTimer.current);

		return () => {
			disposeTimer.current = setTimeout(() => registry.dispose(), 0);
		};
	}, [registry]);

	return <MeasurementSessionsContext.Provider value={registry}>{children}</MeasurementSessionsContext.Provider>;
}
