import { describe, expect, it } from "vitest";
import { createSavedSession, createSourceFromFile } from "./createSavedSession";

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

describe("createSavedSession", () => {
	it("creates one source per file with distinct ids and round-robin layer colors", () => {
		// Five files exercises the round-robin past the 4-entry default palette.
		const files = ["a.wav", "b.wav", "c.wav", "d.wav", "e.wav"];

		const session = createSavedSession(files);

		expect(session.sources).toHaveLength(5);
		expect(new Set(session.sources.map((source) => source.id)).size).toBe(5);
		// Index 0 and index 4 wrap to the same palette entry (palette length 4).
		expect(session.sources[4]?.layerColor).toEqual(session.sources[0]?.layerColor);
		// Adjacent sources differ — the round-robin actually advances.
		expect(session.sources[0]?.layerColor).not.toEqual(session.sources[1]?.layerColor);
		expect(session.activeView).toBe("overlay");
	});

	it("creates an empty, source-less session for the New flow", () => {
		const session = createSavedSession([]);

		expect(session.sources).toEqual([]);
		expect(session.id.length).toBeGreaterThan(0);
	});
});
