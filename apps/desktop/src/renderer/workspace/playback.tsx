import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface WorkspacePlayback {
	readonly positionSec: number;
	readonly durationSec: number;
	readonly playing: boolean;
	readonly onPlayToggle: () => void;
	readonly onSeek: (sec: number) => void;
	readonly selection: { readonly start: number; readonly end: number } | null;
	readonly onSelectionChange: (selection: { start: number; end: number } | null) => void;
}

const PlaybackContext = createContext<WorkspacePlayback | null>(null);

interface WorkspacePlaybackProviderProps {
	readonly value: WorkspacePlayback;
	readonly children: ReactNode;
}

export function WorkspacePlaybackProvider({ value, children }: WorkspacePlaybackProviderProps) {
	return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function useWorkspacePlayback(): WorkspacePlayback {
	const playback = useContext(PlaybackContext);

	if (!playback) throw new Error("Workspace playback requires a comparison provider");

	return playback;
}
