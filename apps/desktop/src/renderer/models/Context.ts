import type { Main } from "./Main";
import type { MainEvents } from "./MainEvents";
import type { ProxyStore } from "./ProxyStore/ProxyStore";
import type { AppState } from "./State/App";
import type { Logger } from "../../shared/models/Logger";
import type { QueryClient } from "@tanstack/react-query";
import type { Snapshot } from "valtio/vanilla";

export interface AppContext {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly logger: Logger;
	readonly main: Main;
	readonly mainEvents: MainEvents;
	readonly queryClient: QueryClient;
	readonly userDataPath: string;
	readonly windowId: string;
	readonly tabNames: Map<string, string>;
	readonly renameCallbacks: Map<string, (name: string) => void>;
	readonly openComparison: () => Promise<void>;
	readonly newComparison: () => Promise<void>;
	readonly renameTab: (tabId: string, newName: string) => void;
}
