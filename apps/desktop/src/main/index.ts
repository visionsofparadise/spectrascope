import { app, BrowserWindow, protocol } from "electron";
import { logger } from "./logger";
import { registerMediaProtocol } from "./mediaProtocol";
import { StreamManager } from "./StreamManager";
import { createWindow } from "./window";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron Forge requires this pattern
if (require("electron-squirrel-startup")) {
	app.quit();
}

protocol.registerSchemesAsPrivileged([
	{ scheme: "media", privileges: { stream: true, supportFetchAPI: true, secure: true } },
]);

const streamManager = new StreamManager();

app.whenReady()
	.then(() => {
		registerMediaProtocol(streamManager);

		return createWindow(logger, streamManager);
	})
	.catch(console.error);

app.on("before-quit", () => {
	streamManager.dispose();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow(logger, streamManager);
	}
});
