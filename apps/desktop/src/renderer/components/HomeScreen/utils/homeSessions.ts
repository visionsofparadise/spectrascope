import { sessionPathKey } from "../../../session/utils/recentSessions";
import type { AppState } from "../../../models/State/App";
import type { Snapshot } from "valtio/vanilla";

export interface HomeSession {
	readonly key: string;
	readonly name: string;
	readonly filePath: string | null;
	readonly lastOpenedAt: string | null;
	readonly tabId: string | null;
}

export function homeSessionsOf(
	app: Pick<Snapshot<AppState>, "tabs" | "comparisons" | "recentSessions">,
): ReadonlyArray<HomeSession> {
	const recentKeys = new Set(app.recentSessions.map((entry) => sessionPathKey(entry.filePath)));
	const openSessions = app.tabs.flatMap((tab): Array<HomeSession> => {
		const comparison = app.comparisons.find((entry) => entry.id === tab.comparisonId);

		if (!comparison) return [];

		if (comparison.sessionFilePath !== null && recentKeys.has(sessionPathKey(comparison.sessionFilePath))) return [];

		return [
			{
				key: `tab:${tab.id}`,
				name: comparison.name,
				filePath: comparison.sessionFilePath,
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
