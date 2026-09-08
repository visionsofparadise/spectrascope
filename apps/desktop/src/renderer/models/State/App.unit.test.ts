import { expect, it, vi } from "vitest";
import { loadAppState } from "./App";

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
