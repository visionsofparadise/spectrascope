import { app, BrowserWindow, protocol } from "electron";
import { logger } from "./logger";
import { registerMediaProtocol } from "./mediaProtocol";
import { StreamManager } from "./StreamManager";
import { createWindow } from "./window";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron Forge requires this pattern
if (require("electron-squirrel-startup")) {
	app.quit();
}

// `media` must be registered as a privileged scheme at module top level —
// before `app.whenReady()` — so the renderer can `fetch()` `media://` URLs.
// `supportFetchAPI` enables `fetch`; `stream` enables ranged streaming for
// `<audio>` playback; `secure` lets it load under the renderer's origin.
protocol.registerSchemesAsPrivileged([
	{ scheme: "media", privileges: { stream: true, supportFetchAPI: true, secure: true } },
]);

// One shared, app-level stream registry backs both the `registerStream` IPC and
// the `media://stream/…` protocol routes; the protocol handler outlives any one
// window, so it is disposed on `before-quit`, not window close.
const streamManager = new StreamManager();

app.whenReady()
	.then(() => {
		// `protocol.handle` registration must run after `app.whenReady()`
		// resolves, before the first window is created.
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
