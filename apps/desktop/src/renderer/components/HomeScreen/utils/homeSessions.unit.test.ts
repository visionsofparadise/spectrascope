import { describe, expect, it } from "vitest";
import { homeSessionsOf } from "./homeSessions";
import type { AppState } from "../../../models/State/App";

const LAST_OPENED_AT = "2026-09-13T12:00:00.000Z";

function appOf(
	open: ReadonlyArray<{ id: string; name: string; sessionFilePath: string | null }>,
	recentSessions: AppState["recentSessions"],
) {
	return {
		tabs: open.map((session) => ({ id: `tab-${session.id}`, sessionId: session.id })),
		sessions: open.map((session) => ({
			id: session.id,
			document: { name: session.name },
			file: { path: session.sessionFilePath },
		})),
		recentSessions,
	} as unknown as AppState;
}

describe("homeSessionsOf", () => {
	it("lists an open session that was never saved", () => {
		expect(homeSessionsOf(appOf([{ id: "a", name: "Raw.wav", sessionFilePath: null }], []))).toEqual([
			{ key: "tab:tab-a", name: "Raw.wav", filePath: null, lastOpenedAt: null, tabId: "tab-a" },
		]);
	});

	it("lists open sessions ahead of recents and folds a saved open session into its recent entry", () => {
		const sessions = homeSessionsOf(
			appOf(
				[
					{ id: "a", name: "Mix", sessionFilePath: "c:\\sessions\\mix.spectra" },
					{ id: "b", name: "Draft", sessionFilePath: null },
				],
				[
					{ filePath: "C:/sessions/mix.spectra", name: "Mix", lastOpenedAt: LAST_OPENED_AT },
					{ filePath: "C:/sessions/old.spectra", name: "Old", lastOpenedAt: LAST_OPENED_AT },
				],
			),
		);
		expect(sessions.map((session) => [session.name, session.tabId])).toEqual([
			["Draft", "tab-b"],
			["Mix", null],
			["Old", null],
		]);
	});

	it("lists a saved open session that is missing from recents", () => {
		expect(homeSessionsOf(appOf([{ id: "a", name: "Mix", sessionFilePath: "C:/sessions/mix.spectra" }], []))).toEqual(
			[{ key: "tab:tab-a", name: "Mix", filePath: "C:/sessions/mix.spectra", lastOpenedAt: null, tabId: "tab-a" }],
		);
	});
});
