import { app, BrowserWindow, protocol } from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { logger } from "./logger";
import { registerMediaProtocol } from "./mediaProtocol";
import { SourceCacheManager } from "./SourceCacheManager";
import { StreamManager } from "./StreamManager";
import { createWindow } from "./window";

if (squirrelStartup) {
	app.quit();
}

protocol.registerSchemesAsPrivileged([
	{ scheme: "media", privileges: { stream: true, supportFetchAPI: true, secure: true } },
]);

let sourceCacheManager: SourceCacheManager | null = null;
const streamManager = new StreamManager(async (pcmPath, targetSampleRate) => {
	const cache = sourceCacheManager;

	if (!cache) throw new Error("Source cache is not ready");

	const lease = await cache.prepareLease(pcmPath, targetSampleRate);

	return {
		pcmPath: lease.prepared.pcmPath,
		release: lease.release,
	};
});

app.whenReady()
	.then(() => {
		registerMediaProtocol(streamManager);
		sourceCacheManager = new SourceCacheManager(app.getPath("userData"), (pcmPath) =>
			streamManager.usesPath(pcmPath),
		);

		return createWindow(logger, streamManager, sourceCacheManager);
	})
	.catch(console.error);

app.on("before-quit", () => {
	streamManager.dispose();
	sourceCacheManager?.dispose();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0 && sourceCacheManager) {
		createWindow(logger, streamManager, sourceCacheManager);
	}
});
