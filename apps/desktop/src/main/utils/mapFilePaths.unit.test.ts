import { expect, it } from "vitest";
import { mapFilePaths } from "./mapFilePaths";

it("roundtrips sibling, parent, different drive and UNC references", () => {
	const baseFilePath = "C:\\sessions\\take.spectra";
	const paths = [
		"C:\\sessions\\audio\\take.wav",
		"C:\\audio\\take.wav",
		"D:\\audio\\take.wav",
		"\\\\server\\share\\audio.wav",
		"",
	];
	const relative = mapFilePaths({ baseFilePath, paths, mode: "relative" });
	expect(relative).toEqual([
		"audio/take.wav",
		"../audio/take.wav",
		"D:/audio/take.wav",
		"//server/share/audio.wav",
		"",
	]);
	expect(mapFilePaths({ baseFilePath, paths: relative, mode: "absolute" })).toEqual(paths);
});

it("uses POSIX paths without changing case", () => {
	expect(
		mapFilePaths({ baseFilePath: "/sessions/test.spectra", paths: ["../Audio/test.wav"], mode: "absolute" }),
	).toEqual(["/Audio/test.wav"]);
});
