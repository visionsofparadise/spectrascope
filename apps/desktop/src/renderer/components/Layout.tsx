import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createComparison, createTabId } from "../comparison/createComparison";
import { pickAudioFiles } from "../comparison/pickAudioFiles";
import { useAutosave } from "../hooks/useAutosave";
import { useWindowState } from "../hooks/useWindowState";
import { main } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import { useAppState, type AppState, type Comparison } from "../models/State/App";
import { AppBar } from "./AppBar";
import { TabContent } from "./Tab";
import type { Logger } from "../../shared/models/Logger";
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

	const tabNamesRef = useRef(new Map<string, string>());
	const renameCallbacksRef = useRef(new Map<string, (name: string) => void>());

	const [historyControl, setHistoryControl] = useState<HistoryControl | null>(null);

	const labelForComparison = useCallback(
		(comparison: Comparison): string => comparison.sources[0]?.name ?? "New Comparison",
		[],
	);

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

	const openComparison = useCallback(async (): Promise<void> => {
		const filePaths = await pickAudioFiles();

		if (filePaths) openComparisonTab(createComparison(filePaths));
	}, [openComparisonTab]);

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
		[
			app,
			appStore,
			logger,
			mainEvents,
			queryClient,
			windowId,
			userDataPath,
			openComparison,
			newComparison,
			renameTab,
		],
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
