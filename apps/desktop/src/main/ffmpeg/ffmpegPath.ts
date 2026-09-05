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

	return ffmpegStatic;
};
