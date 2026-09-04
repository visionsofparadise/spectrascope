import path from "node:path";
import { app } from "electron";
import ffmpegStatic from "ffmpeg-static";

/**
 * Absolute path to the ffmpeg executable.
 *
 * In development the `ffmpeg-static` package resolves the binary inside
 * `node_modules`. In a packaged build the binary is copied into the app's
 * `resources/` directory by Electron Forge's `packagerConfig.extraResource`,
 * so it is resolved relative to `process.resourcesPath` instead.
 */
export const getFfmpegPath = (): string => {
	if (ffmpegStatic === null) {
		throw new Error("ffmpeg-static did not provide a binary path for this platform");
	}

	if (app.isPackaged) {
		return path.join(process.resourcesPath, path.basename(ffmpegStatic));
	}

	return ffmpegStatic;
};
