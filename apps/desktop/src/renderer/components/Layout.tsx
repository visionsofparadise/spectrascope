import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAutosave } from "../hooks/useAutosave";
import { useSessionActions } from "../hooks/useSessionActions";
import { useWindowState } from "../hooks/useWindowState";
import { main } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import { useAppState, type AppState } from "../models/State/App";
import { MeasurementSessionsProvider } from "../workspace/spectral/MeasurementSessionsProvider";
import { AppBar } from "./AppBar";
import { ExportDialog } from "./ExportDialog";
import { PreferencesDialog } from "./PreferencesDialog";
import { TabContent } from "./Tab";
import type { Logger } from "../../shared/models/Logger";
import type { ExportControl, ExportKind, ExportRange } from "../export/ExportControl";
import type { AppContext } from "../models/Context";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { HistoryControl } from "../state/useComparisonHistory";
import type { QueryClient } from "@tanstack/react-query";

interface Props {
	readonly initialState: Omit<AppState, "_key">;
	readonly windowId: string;
	readonly userDataPath: string;
	readonly appStore: ProxyStore;
	readonly queryClient: QueryClient;
	readonly logger: Logger;
}

export function AppLayout({ initialState, windowId, userDataPath, appStore, queryClient, logger }: Props) {
	const app = useAppState(initialState, appStore);

	const mainEvents = useMemo(() => new MainEvents(main), []);

	useWindowState(app, appStore, main, mainEvents);
	useAutosave(app, appStore, main, userDataPath);

	const sessions = useSessionActions(app, appStore, main);
	const [historyControl, setHistoryControl] = useState<HistoryControl | null>(null);
	const [exportControl, setExportControl] = useState<ExportControl | null>(null);
	const [exportDialog, setExportDialog] = useState<ExportControl | null>(null);
	const [preferencesOpen, setPreferencesOpen] = useState(false);
	const [exportStatus, setExportStatus] = useState<string | null>(null);
	const [exportBusy, setExportBusy] = useState(false);
	const exporting = useRef(false);
	const runExport = async (kind: ExportKind, range: ExportRange): Promise<void> => {
		const control = exportDialog;

		if (!control || exporting.current) return;

		exporting.current = true;
		setExportBusy(true);
		setExportDialog(null);
		setExportStatus(null);

		try {
			await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

			let filePath: string | null;

			if (kind === "png") {
				const pane = document.querySelector("main");

				if (!pane) throw new Error("Open an inspection view before exporting an image.");

				const { x, y, width, height } = pane.getBoundingClientRect();

				filePath = await main.exportImage({
					rect: { x, y, width, height },
					suggestedName: control.name,
					protectedPaths: control.protectedPaths,
				});
			} else {
				if (!control.streamKey) throw new Error("Prepare audio before exporting.");

				const selected = range === "selection" ? control.selection : null;

				filePath = await main.exportStream({
					key: control.streamKey,
					kind,
					suggestedName: control.name,
					protectedPaths: control.protectedPaths,
					startMs: selected?.start,
					endMs: selected?.end,
				});
			}

			setExportStatus(filePath ? `Exported to ${filePath}` : null);
		} catch (cause) {
			setExportStatus(`Export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
		} finally {
			exporting.current = false;
			setExportBusy(false);
		}
	};
	const context: AppContext = {
		app,
		appStore,
		logger,
		main,
		mainEvents,
		queryClient,
		userDataPath,
		windowId,
		...sessions,
	};

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (document.querySelector("dialog[open]")) return;

			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

			const key = event.key.toLowerCase();

			if (key === "s") {
				event.preventDefault();
				void sessions.saveComparison(event.shiftKey);
			}

			if (key === "o") {
				event.preventDefault();
				void sessions.openComparison();
			}
		};

		window.addEventListener("keydown", onKeyDown);

		return () => window.removeEventListener("keydown", onKeyDown);
	}, [sessions]);

	useEffect(() => {
		if (app.activeTabId === null) {
			setHistoryControl(null);
			setExportControl(null);
		}
	}, [app.activeTabId]);

	useLayoutEffect(() => {
		if (app.theme === "viridis") {
			document.documentElement.setAttribute("data-theme", "viridis");
		} else {
			document.documentElement.removeAttribute("data-theme");
		}
	}, [app.theme]);

	return (
		<div className="flex flex-col h-screen">
			<AppBar
				context={context}
				historyControl={historyControl}
				canExport={exportControl !== null && !exportBusy}
				onExport={() => setExportDialog(exportControl)}
				onPreferences={() => setPreferencesOpen(true)}
			/>
			{sessions.error && (
				<div
					role="alert"
					className="flex shrink-0 items-center justify-between gap-3 bg-chrome-raised px-4 py-2 text-sm text-chrome-text"
				>
					<span>{sessions.error}</span>
					<button type="button" onClick={sessions.clearError}>
						Dismiss
					</button>
				</div>
			)}
			{exportStatus && (
				<div
					role="status"
					className="flex shrink-0 items-center justify-between gap-3 bg-chrome-raised px-4 py-2 text-sm text-chrome-text"
				>
					<span className="min-w-0 break-all">{exportStatus}</span>
					<button type="button" onClick={() => setExportStatus(null)}>
						Dismiss
					</button>
				</div>
			)}
			{exportBusy && (
				<div
					role="status"
					className="pointer-events-none fixed right-60 top-3 z-50 bg-void px-2 font-technical text-sm text-primary"
				>
					Exporting…
				</div>
			)}
			<MeasurementSessionsProvider
				comparisons={app.comparisons}
				activeSessionId={app.tabs.find((tab) => tab.id === app.activeTabId)?.comparisonId ?? null}
			>
				<TabContent
					context={context}
					onHistoryControlChange={setHistoryControl}
					onExportControlChange={setExportControl}
				/>
			</MeasurementSessionsProvider>
			{exportDialog && (
				<ExportDialog
					control={exportDialog}
					onClose={() => setExportDialog(null)}
					onExport={(kind, range) => void runExport(kind, range)}
				/>
			)}
			{preferencesOpen && (
				<PreferencesDialog
					preferences={app.preferences}
					theme={app.theme}
					onPreferencesChange={(preferences) =>
						appStore.mutate(app, (proxy) => {
							proxy.preferences = preferences;
						})
					}
					onThemeChange={(theme) =>
						appStore.mutate(app, (proxy) => {
							proxy.theme = theme;
						})
					}
					onClose={() => setPreferencesOpen(false)}
				/>
			)}
		</div>
	);
}
