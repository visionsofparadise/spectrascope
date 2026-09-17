import { batch, identify } from "opshot";
import { useMutableState } from "opshot/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAutosave } from "../hooks/useAutosave";
import { useSessionActions } from "../hooks/useSessionActions";
import { useWindowState } from "../hooks/useWindowState";
import { automaticMeta } from "../models/History";
import { main } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import { useAppState } from "../models/State/App";
import { MeasurementSessionsProvider } from "../workspace/spectral/MeasurementSessionsProvider";
import { AppBar } from "./AppBar";
import { ExportDialog } from "./ExportDialog";
import { PreferencesDialog } from "./PreferencesDialog";
import { TabContent } from "./Tab";
import type { Logger } from "../../shared/models/Logger";
import type { ExportControl, ExportKind, ExportRange } from "../export/ExportControl";
import type { AppContext, SessionStatus } from "../models/Context";
import type { QueryClient } from "@tanstack/react-query";

interface Props {
	readonly initialState: Parameters<typeof useAppState>[0];
	readonly userDataPath: string;
	readonly queryClient: QueryClient;
	readonly logger: Logger;
}

export function AppLayout({ initialState, userDataPath, queryClient, logger }: Props) {
	const app = useAppState(initialState);
	const sessionStatus = useMutableState<SessionStatus>({ busy: false, error: null });

	const mainEvents = useMemo(() => new MainEvents(main), []);

	useWindowState(app, main, mainEvents);
	useAutosave(app, main, userDataPath);

	const sessions = useSessionActions(app, sessionStatus, main);
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
	const context = useMemo(
		(): AppContext => ({
			app,
			sessionStatus,
			logger,
			main,
			mainEvents,
			queryClient,
			userDataPath,
			...sessions,
		}),
		[identify(app), identify(sessionStatus), sessions, logger, mainEvents, queryClient, userDataPath],
	);
	const activeSessionId = app.tabs.find((tab) => tab.id === app.activeTabId)?.sessionId ?? null;
	const activeSession = app.sessions.find((session) => session.id === activeSessionId);
	const measuredSourcesKey = JSON.stringify(
		app.sessions.map((session) => [
			session.id,
			session.document.sources.map((source) => [source.id, source.audioFilePath]),
		]),
	);
	const measuredSessions = useMemo(
		() =>
			app.sessions.map((session) => ({
				id: session.id,
				sources: session.document.sources.map((source) => ({ id: source.id, audioFilePath: source.audioFilePath })),
			})),
		[measuredSourcesKey],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (document.querySelector("dialog[open]")) return;

			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

			const key = event.key.toLowerCase();

			if (key === "s") {
				event.preventDefault();
				void sessions.saveSession(event.shiftKey);
			}

			if (key === "o") {
				event.preventDefault();
				void sessions.openSession();
			}
		};

		window.addEventListener("keydown", onKeyDown);

		return () => window.removeEventListener("keydown", onKeyDown);
	}, [sessions]);

	useEffect(() => {
		if (app.activeTabId === null) {
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
				history={activeSession?.history ?? null}
				canExport={exportControl !== null && !exportBusy}
				exportBusy={exportBusy}
				onExport={() => setExportDialog(exportControl)}
				onPreferences={() => setPreferencesOpen(true)}
			/>
			{context.sessionStatus.error && (
				<div
					role="alert"
					className="flex shrink-0 items-center justify-between gap-3 bg-chrome-raised px-4 py-2 text-sm text-chrome-text"
				>
					<span>{context.sessionStatus.error}</span>
					<button
						type="button"
						onClick={() => {
							context.sessionStatus.error = null;
						}}
					>
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
			<MeasurementSessionsProvider sessions={measuredSessions} activeSessionId={activeSessionId}>
				<TabContent context={context} onExportControlChange={setExportControl} />
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
					onPreferencesChange={(preferences) => {
						app.preferences = preferences;
					}}
					onThemeChange={(theme) => {
						app.theme = theme;
						batch(() => {
							for (const session of app.sessions) session.document.renderSettings.spectrogramColormap = theme;
						}, automaticMeta);
					}}
					onClose={() => setPreferencesOpen(false)}
				/>
			)}
		</div>
	);
}
