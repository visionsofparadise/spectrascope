import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";
import ffmpegStatic from "ffmpeg-static";

export const getFfmpegPath = (): string => {
	if (ffmpegStatic === null) {
		throw new Error("ffmpeg-static did not provide a binary path for this platform");
	}

	if (app.isPackaged) {
		return path.join(process.resourcesPath, path.basename(ffmpegStatic));
	}

	const binaryPath = createRequire(path.join(app.getAppPath(), "package.json"))("ffmpeg-static") as string | null;

	if (binaryPath === null) throw new Error("ffmpeg-static did not provide a binary path for this platform");

	return binaryPath;
};
