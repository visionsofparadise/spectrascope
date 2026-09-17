import { expect, it, vi } from "vitest";
import { mapFilePaths } from "../../../main/utils/mapFilePaths";
import { createSavedSession } from "../createSavedSession";
import { openSessionFile, saveSessionFile } from "./sessionFiles";
import { isSessionDirty } from "./sessionFingerprint";

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
	await saveSessionFile(io, createSavedSession(["C:/original/audio/missing.wav"]), "C:/original/project.spectra");
	const restored = await openSessionFile(io, "D:/moved/project.spectra");
	expect(restored.sources[0]?.audioFilePath).toBe("D:\\moved\\audio\\missing.wav");
	expect(isSessionDirty(restored)).toBe(false);
});
