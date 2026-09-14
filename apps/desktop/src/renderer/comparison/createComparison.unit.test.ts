import { describe, expect, it } from "vitest";
import { createComparison, createSourceFromFile } from "./createComparison";

describe("createSourceFromFile", () => {
	it("derives the source name from the file's trailing path segment", () => {
		const windowsPath = "C:\\Users\\me\\Audio\\reference-mix.wav";

		const source = createSourceFromFile(windowsPath, 0);

		expect(source.name).toBe("reference-mix.wav");
		expect(source.audioFilePath).toBe(windowsPath);
		expect(source.timelineOffsetMs).toBe(0);
	});

	it("handles a POSIX path", () => {
		expect(createSourceFromFile("/home/me/take 3.flac", 0).name).toBe("take 3.flac");
	});
});

describe("createComparison", () => {
	it("creates one source per file with distinct ids and round-robin layer colors", () => {
		// Five files exercises the round-robin past the 4-entry default palette.
		const files = ["a.wav", "b.wav", "c.wav", "d.wav", "e.wav"];

		const comparison = createComparison(files);

		expect(comparison.sources).toHaveLength(5);
		expect(new Set(comparison.sources.map((source) => source.id)).size).toBe(5);
		// Index 0 and index 4 wrap to the same palette entry (palette length 4).
		expect(comparison.sources[4]?.layerColor).toEqual(comparison.sources[0]?.layerColor);
		// Adjacent sources differ — the round-robin actually advances.
		expect(comparison.sources[0]?.layerColor).not.toEqual(comparison.sources[1]?.layerColor);
		expect(comparison.activeView).toBe("overlay");
	});

	it("creates an empty, source-less comparison for the New flow", () => {
		const comparison = createComparison([]);

		expect(comparison.sources).toEqual([]);
		expect(comparison.id.length).toBeGreaterThan(0);
	});
});
