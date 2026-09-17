import type { Main } from "./Main";
import type { MainEvents } from "./MainEvents";
import type { SessionActions } from "../hooks/useSessionActions";
import type { AppState } from "./State/App";
import type { PlaybackControls, PlaybackState } from "./State/Playback";
import type { Session } from "./State/Session";
import type { Logger } from "../../shared/models/Logger";
import type { QueryClient } from "@tanstack/react-query";

export interface SessionStatus {
	busy: boolean;
	error: string | null;
}

export interface AppContext extends SessionActions {
	readonly app: AppState;
	readonly sessionStatus: SessionStatus;
	readonly logger: Logger;
	readonly main: Main;
	readonly mainEvents: MainEvents;
	readonly queryClient: QueryClient;
	readonly userDataPath: string;
}

export interface SessionContext extends AppContext {
	readonly session: Session;
	readonly playback: PlaybackState;
	readonly playbackControls: PlaybackControls;
	readonly sessionDurationMs: number;
}
