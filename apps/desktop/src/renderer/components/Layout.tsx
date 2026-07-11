import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Logger } from "../../shared/models/Logger";
import { AUDIO_FILE_EXTENSIONS, createComparison, createTabId } from "../comparison/createComparison";
import { useAutosave } from "../hooks/useAutosave";
import { useWindowState } from "../hooks/useWindowState";
import type { AppContext } from "../models/Context";
import { main } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import { useAppState, type AppState, type Comparison } from "../models/State/App";
import type { HistoryControl } from "../state/useComparisonHistory";
import { AppBar } from "./AppBar";
import { TabContent } from "./Tab";

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

	const tabNamesRef = useRef(new Map<string, string>());
	const renameCallbacksRef = useRef(new Map<string, (name: string) => void>());

	// The active comparison's undo/redo control, published up from `ComparisonTab`
	// (the `TransportControl` publishing pattern) so the app bar can drive it. Reset
	// to `null` when no tab is active (Home) — the publisher only lives inside a
	// mounted `ComparisonTab`, so Home would otherwise keep the last tab's stale
	// control.
	const [historyControl, setHistoryControl] = useState<HistoryControl | null>(null);

	/**
	 * The tab label for a comparison — the first source's name (its file name),
	 * or "New Comparison" when the comparison has no sources yet. Tab labels
	 * live in the renderer-only `tabNames` map (not persisted state); a
	 * comparison opened from saved state has no entry until something repopulates
	 * it, so the tab bar falls back to "Comparison".
	 */
	const labelForComparison = useCallback((comparison: Comparison): string => comparison.sources[0]?.name ?? "New Comparison", []);

	/**
	 * Append a comparison to the store, open a tab referencing it, activate that
	 * tab, and register the tab's display label. A single `appStore.mutate`
	 * keeps the comparison + tab + active-id change one atomic autosave step.
	 */
	const openComparisonTab = useCallback(
		(comparison: Comparison): void => {
			const tabId = createTabId();

			tabNamesRef.current.set(tabId, labelForComparison(comparison));

			appStore.mutate(app, (proxy) => {
				proxy.comparisons.push(comparison);
				proxy.tabs.push({ id: tabId, comparisonId: comparison.id });
				proxy.activeTabId = tabId;
			});
		},
		[app, appStore, labelForComparison],
	);

	/**
	 * Open the audio-file dialog and create a comparison from the chosen files.
	 * A cancelled dialog (`undefined`) or an empty selection opens nothing.
	 */
	const openComparison = useCallback(async (): Promise<void> => {
		const filePaths = await main.showOpenDialog({
			filters: [{ name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
			properties: ["openFile", "multiSelections"],
		});

		if (!filePaths || filePaths.length === 0) return;

		openComparisonTab(createComparison(filePaths));
	}, [openComparisonTab]);

	/**
	 * Create an empty comparison (no sources). Sources are added afterwards via
	 * the sources panel's add affordance. Synchronous; returns a resolved promise
	 * to satisfy the shared `() => Promise<void>` context contract.
	 */
	const newComparison = useCallback((): Promise<void> => {
		openComparisonTab(createComparison([]));

		return Promise.resolve();
	}, [openComparisonTab]);

	const renameTab = useCallback((tabId: string, newName: string) => {
		const callback = renameCallbacksRef.current.get(tabId);

		if (callback) {
			callback(newName);
		}
	}, []);

	const context: AppContext = useMemo(
		() => ({
			app,
			appStore,
			logger,
			main,
			mainEvents,
			queryClient,
			userDataPath,
			windowId,
			tabNames: tabNamesRef.current,
			renameCallbacks: renameCallbacksRef.current,
			openComparison,
			newComparison,
			renameTab,
		}),
		[app, appStore, logger, mainEvents, queryClient, windowId, userDataPath, openComparison, newComparison, renameTab],
	);

	useEffect(() => {
		if (app.activeTabId === null) {
			setHistoryControl(null);
		}
	}, [app.activeTabId]);

	useEffect(() => {
		if (app.theme === "viridis") {
			document.documentElement.setAttribute("data-theme", "viridis");
		} else {
			document.documentElement.removeAttribute("data-theme");
		}
	}, [app.theme]);

	return (
		<div className="flex flex-col h-screen">
			<AppBar context={context} historyControl={historyControl} />
			<TabContent context={context} onHistoryControlChange={setHistoryControl} />
		</div>
	);
}
