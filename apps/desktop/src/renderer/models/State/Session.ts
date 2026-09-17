import { createMutableState } from "opshot";
import { createHistory, type History } from "../History";
import type { SavedSession, SourceState } from "./App";
import type { ViewControlSettingsSchema } from "../../workspace/viewSettings";
import type { ViewId } from "../../workspace/Workspace";
import type { ChannelInput } from "spectral-display";
import type { z } from "zod";

export type RenderSettings = Omit<z.infer<typeof ViewControlSettingsSchema>, "frequencyRange">;

export interface DocumentState {
	name: string;
	sources: Array<SourceState>;
	channelInput: ChannelInput;
	selection: { start: number; end: number } | null;
	canonicalSampleRate: number | null;
	differenceA: string | null;
	differenceB: string | null;
	renderSettings: RenderSettings;
	volume: number;
}

export interface TransportState {
	looping: boolean;
	playbackRate: number;
	positionSec: number;
}

export interface NavigationState {
	activeView: ViewId;
	frequencyRange: { top: number; bottom: number };
}

export interface FileState {
	path: string | null;
	savedFingerprint: string | null;
}

export interface Session {
	readonly id: string;
	readonly document: DocumentState;
	readonly transport: TransportState;
	readonly navigation: NavigationState;
	readonly file: FileState;
	readonly history: History;
}

export function createSession(saved: SavedSession): Session {
	const copy = JSON.parse(JSON.stringify(saved)) as SavedSession;
	const { frequencyRange, ...renderSettings } = copy.viewSettings;
	const document = createMutableState<DocumentState>({
		name: copy.name,
		sources: copy.sources,
		channelInput: copy.channelInput,
		selection: copy.selection,
		canonicalSampleRate: copy.canonicalSampleRate,
		differenceA: copy.differenceA,
		differenceB: copy.differenceB,
		renderSettings,
		volume: copy.volume,
	});

	return {
		id: copy.id,
		document,
		transport: createMutableState<TransportState>({
			looping: copy.looping,
			playbackRate: copy.playbackRate,
			positionSec: copy.positionSec,
		}),
		navigation: createMutableState<NavigationState>({ activeView: copy.activeView, frequencyRange }),
		file: createMutableState<FileState>({ path: copy.sessionFilePath, savedFingerprint: copy.savedFingerprint }),
		history: createHistory(document),
	};
}

export function savedSessionOf(session: Session): SavedSession {
	const { document, transport, navigation, file } = session;
	const saved: SavedSession = {
		id: session.id,
		name: document.name,
		viewSettings: { ...document.renderSettings, frequencyRange: navigation.frequencyRange },
		volume: document.volume,
		playbackRate: transport.playbackRate,
		looping: transport.looping,
		sessionFilePath: file.path,
		savedFingerprint: file.savedFingerprint,
		sources: document.sources,
		activeView: navigation.activeView,
		channelInput: document.channelInput,
		positionSec: transport.positionSec,
		selection: document.selection,
		canonicalSampleRate: document.canonicalSampleRate,
		differenceA: document.differenceA,
		differenceB: document.differenceB,
	};

	return JSON.parse(JSON.stringify(saved)) as SavedSession;
}
