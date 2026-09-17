import { sessionPathKey } from "../../../session/utils/recentSessions";
import type { AppState } from "../../../models/State/App";

export interface HomeSession {
	readonly key: string;
	readonly name: string;
	readonly filePath: string | null;
	readonly lastOpenedAt: string | null;
	readonly tabId: string | null;
}

export function homeSessionsOf(
	app: Pick<AppState, "tabs" | "sessions" | "recentSessions">,
): ReadonlyArray<HomeSession> {
	const recentKeys = new Set(app.recentSessions.map((entry) => sessionPathKey(entry.filePath)));
	const openSessions = app.tabs.flatMap((tab): Array<HomeSession> => {
		const session = app.sessions.find((entry) => entry.id === tab.sessionId);

		if (!session) return [];

		if (session.file.path !== null && recentKeys.has(sessionPathKey(session.file.path))) return [];

		return [
			{
				key: `tab:${tab.id}`,
				name: session.document.name,
				filePath: session.file.path,
				lastOpenedAt: null,
				tabId: tab.id,
			},
		];
	});
	const recentSessions = app.recentSessions.map((entry): HomeSession => ({
		key: `file:${entry.filePath}`,
		name: entry.name,
		filePath: entry.filePath,
		lastOpenedAt: entry.lastOpenedAt,
		tabId: null,
	}));

	return [...openSessions, ...recentSessions];
}
