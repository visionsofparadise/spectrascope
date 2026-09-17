import path from "path";
import { BrowserWindow } from "electron";
import { ASYNC_MAIN_IPCS } from "../shared/ipc/asyncMainIpcs";
import { FileWatcherManager } from "./FileWatcherManager";
import type { SourceCacheManager } from "./SourceCacheManager";
import type { StreamManager } from "./StreamManager";
import type { Logger } from "../shared/models/Logger";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

declare const MAIN_WINDOW_VITE_NAME: string;

const WINDOW_CONFIG = {
	width: 1200,
	height: 800,
	minWidth: 600,
	minHeight: 400,
	titleBarStyle: "hidden" as const,
	titleBarOverlay: {
		color: "#020204",
		symbolColor: "#B8B8C0",
		height: 48,
	},
};

export const createWindow = (
	logger: Logger,
	streamManager: StreamManager,
	sourceCacheManager: SourceCacheManager,
): BrowserWindow => {
	const browserWindow = new BrowserWindow({
		...WINDOW_CONFIG,
		icon: MAIN_WINDOW_VITE_DEV_SERVER_URL ? path.join(__dirname, "../../assets/icon.png") : undefined,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	const fileWatcherManager = new FileWatcherManager(browserWindow);

	for (const AsyncMainIpc of ASYNC_MAIN_IPCS) {
		new AsyncMainIpc().register({
			browserWindow,
			fileWatcherManager,
			sourceCacheManager,
			streamManager,
			logger,
		});
	}

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const emitBounds = (): void => {
		const { x, y, width, height } = browserWindow.getBounds();

		browserWindow.webContents.send("windowBoundsChanged", { x, y, width, height });
	};

	const debouncedEmit = (): void => {
		if (debounceTimer) clearTimeout(debounceTimer);

		debounceTimer = setTimeout(emitBounds, 500);
	};

	browserWindow.on("move", debouncedEmit);
	browserWindow.on("resize", debouncedEmit);

	browserWindow.on("close", () => {
		if (debounceTimer) clearTimeout(debounceTimer);

		emitBounds();
	});

	browserWindow.on("closed", () => {
		fileWatcherManager.dispose();
		streamManager.reset();
		sourceCacheManager.reset();
	});

	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		browserWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL).catch((error: unknown) => {
			logger.error("Failed to load dev server URL", error as Error, {
				namespace: "window",
				url: MAIN_WINDOW_VITE_DEV_SERVER_URL,
			});
		});
	} else {
		const filePath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);

		browserWindow.loadFile(filePath).catch((error: unknown) => {
			logger.error("Failed to load file", error as Error, { namespace: "window", filePath });
		});
	}

	browserWindow.on("ready-to-show", () => {
		browserWindow.show();
	});

	return browserWindow;
};
