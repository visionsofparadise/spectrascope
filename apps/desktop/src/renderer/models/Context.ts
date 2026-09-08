import type { Main } from "./Main";
import type { MainEvents } from "./MainEvents";
import type { SessionActions } from "../hooks/useSessionActions";
import type { ProxyStore } from "./ProxyStore/ProxyStore";
import type { AppState } from "./State/App";
import type { Logger } from "../../shared/models/Logger";
import type { QueryClient } from "@tanstack/react-query";
import type { Snapshot } from "valtio/vanilla";

export interface AppContext extends SessionActions {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly logger: Logger;
	readonly main: Main;
	readonly mainEvents: MainEvents;
	readonly queryClient: QueryClient;
	readonly userDataPath: string;
	readonly windowId: string;
}
