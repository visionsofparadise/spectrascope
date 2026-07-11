import { describe, expect, it } from "vitest";
import type { Source } from "../workspace/source";
import { createComparison, createSourceFromFile, isBareAddSource } from "./createComparison";

/** Minimal `Source` factory for the diff tests — only the fields `isBareAddSource` reads. */
function makeSource(id: string, audioFilePath: string): Source {
	return {
		id,
		name: id,
		audioFilePath,
		timelineOffsetMs: 0,
		layerColor: { primary: "#000000", secondary: "#111111" },
		visible: true,
		muted: false,
		soloed: false,
	};
}

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

describe("isBareAddSource", () => {
	const a = makeSource("a", "a.wav");
	const b = makeSource("b", "b.wav");

	it("is true when one file-less source is appended and prior sources are unchanged", () => {
		const bare = makeSource("new", "");

		expect(isBareAddSource([a, b], [a, b, bare])).toBe(true);
	});

	it("is false when the appended source carries a file path", () => {
		const withFile = makeSource("new", "new.wav");

		expect(isBareAddSource([a, b], [a, b, withFile])).toBe(false);
	});

	it("is false when the count change is not exactly +1 (a remove, or a multi-add)", () => {
		expect(isBareAddSource([a, b], [a])).toBe(false);
		expect(isBareAddSource([a, b], [a, b, makeSource("x", ""), makeSource("y", "")])).toBe(false);
	});

	it("is false when a prior source was edited rather than only appended to", () => {
		// Same length delta (+1) but the first source's identity changed — this is
		// an edit-plus-add, not the panel's bare add, so it must not be hijacked.
		const editedA = makeSource("a-edited", "a.wav");
		const bare = makeSource("new", "");

		expect(isBareAddSource([a, b], [editedA, b, bare])).toBe(false);
	});

	it("is true for the first add into an empty comparison", () => {
		expect(isBareAddSource([], [makeSource("first", "")])).toBe(true);
	});
});
