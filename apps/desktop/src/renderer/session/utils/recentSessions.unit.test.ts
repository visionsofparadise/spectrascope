import { expect, it } from "vitest";
import { addRecentSession } from "./recentSessions";
import type { AppState } from "../../models/State/App";

it("keeps ten recent sessions and moves case-insensitive Windows duplicates to the front", () => {
	let recent: AppState["recentSessions"] = [];
	for (let index = 0; index < 12; index++)
		recent = addRecentSession(recent, `C:/sessions/${index}.spectra`, String(index));
	recent = addRecentSession(recent, "c:\\sessions\\5.spectra", "Renamed");
	expect(recent).toHaveLength(10);
	expect(recent[0]?.name).toBe("Renamed");
	expect(recent.filter((entry) => entry.name === "5")).toHaveLength(0);
});
