import { expect, it, vi } from "vitest";
import { mapFilePaths } from "../../../main/utils/mapFilePaths";
import { createComparison } from "../createComparison";
import { openSessionFile, saveSessionFile } from "./sessionFiles";
import { isComparisonDirty } from "./comparisonFingerprint";

it("opens a moved session with missing media references intact and clean saved content", async () => {
	let content = "";
	const io = {
		mapFilePaths: vi
			.fn()
			.mockImplementation((options: Parameters<typeof mapFilePaths>[0]) => Promise.resolve(mapFilePaths(options))),
		writeFile: vi.fn().mockImplementation((_path: string, data: string) => {
			content = data;
			return Promise.resolve();
		}),
		readFile: vi.fn().mockImplementation(() => Promise.resolve(content)),
	};
	await saveSessionFile(io, createComparison(["C:/original/audio/missing.wav"]), "C:/original/project.spectra");
	const restored = await openSessionFile(io, "D:/moved/project.spectra");
	expect(restored.sources[0]?.audioFilePath).toBe("D:\\moved\\audio\\missing.wav");
	expect(isComparisonDirty(restored)).toBe(false);
});
