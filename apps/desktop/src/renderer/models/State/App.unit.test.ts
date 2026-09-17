import { expect, it, vi } from "vitest";
import { sessionContent, isSessionDirty } from "../../session/utils/sessionFingerprint";
import { SavedSessionSchema, loadAppState } from "./App";

it("migrates old recovery state with persistent names and new defaults", async () => {
	const old = {
		comparisons: [
			{
				id: "old",
				sources: [
					{
						id: "source",
						name: "Original.wav",
						audioFilePath: "/missing.wav",
						timelineOffsetMs: 0,
						layerColor: { primary: "red", secondary: "blue" },
						visible: true,
						muted: false,
						soloed: false,
					},
				],
			},
		],
		tabs: [{ id: "tab", comparisonId: "old" }],
		activeTabId: "tab",
	};
	const state = await loadAppState({
		getUserDataPath: vi.fn().mockResolvedValue("/state"),
		readFile: vi.fn().mockResolvedValue(JSON.stringify(old)),
	});
	expect(state.comparisons[0]?.name).toBe("Original.wav");
	expect(state.comparisons[0]?.viewSettings.frequencyRange).toEqual({ top: 0, bottom: 1 });
	expect(state.preferences.sampleRate).toBeNull();
	expect(state.recentSessions).toEqual([]);
	expect(state.activeTabId).toBe("tab");
});

it("keeps a restored session clean when its fingerprint was recorded with syncEnabled", async () => {
	const stored = (id: string, syncEnabled: boolean) => {
		const session = SavedSessionSchema.parse({ id, name: "Stored" });

		return { ...session, savedFingerprint: JSON.stringify({ ...sessionContent(session), syncEnabled }) };
	};
	const clean = stored("clean", true);
	const edited = { ...stored("edited", false), name: "Edited" };
	const state = await loadAppState({
		getUserDataPath: vi.fn().mockResolvedValue("/state"),
		readFile: vi.fn().mockResolvedValue(JSON.stringify({ comparisons: [clean, edited] })),
	});
	expect(clean.savedFingerprint).toContain('"syncEnabled":true}');
	expect(state.comparisons[0] && isSessionDirty(state.comparisons[0])).toBe(false);
	expect(state.comparisons[1] && isSessionDirty(state.comparisons[1])).toBe(true);
});
