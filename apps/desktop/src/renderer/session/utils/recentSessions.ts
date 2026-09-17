import type { AppState } from "../../models/State/App";

export function sessionPathKey(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");

	return /^[a-z]:\/|^\/\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function addRecentSession(
	recent: AppState["recentSessions"],
	filePath: string,
	name: string,
): AppState["recentSessions"] {
	return [
		{ filePath, name, lastOpenedAt: new Date().toISOString() },
		...recent.filter((entry) => sessionPathKey(entry.filePath) !== sessionPathKey(filePath)),
	].slice(0, 10);
}
