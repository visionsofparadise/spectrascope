import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Logger } from "../../shared/models/Logger";
import { useAutosave } from "../hooks/useAutosave";
import { useWindowState } from "../hooks/useWindowState";
import type { AppContext } from "../models/Context";
import { main } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import { useAppState, type AppState } from "../models/State/App";
import { AppTabBar } from "./TabBar";
import { TitleBar } from "./TitleBar";
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

	const openBagTab = useCallback(async () => {}, []);
	const openBagByPath = useCallback(async (_bagPath: string) => {}, []);
	const newBagTab = useCallback(async () => {}, []);

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
			openBagTab,
			openBagByPath,
			newBagTab,
			renameTab,
		}),
		[app, appStore, logger, mainEvents, queryClient, windowId, userDataPath, openBagTab, openBagByPath, newBagTab, renameTab],
	);

	useEffect(() => {
		if (app.theme === "viridis") {
			document.documentElement.setAttribute("data-theme", "viridis");
		} else {
			document.documentElement.removeAttribute("data-theme");
		}
	}, [app.theme]);

	return (
		<div className="flex flex-col h-screen">
			<TitleBar context={context} />
			<AppTabBar context={context} />
			<TabContent context={context} />
		</div>
	);
}
