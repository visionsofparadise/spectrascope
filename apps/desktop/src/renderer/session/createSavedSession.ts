import { SavedSessionSchema, INITIAL_PREFERENCES, type Preferences } from "../models/State/App";
import { createDefaultSource } from "../workspace/source";
import { sessionFingerprint } from "./utils/sessionFingerprint";
import type { SavedSession, SourceState } from "../models/State/App";
import type { ThemeId } from "../utils/themePalettes";
import type { Source } from "../workspace/source";

export const AUDIO_FILE_EXTENSIONS = ["wav", "mp3", "flac", "m4a", "ogg", "aiff"] as const;

function generateId(): string {
	const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;

	if (cryptoRef?.randomUUID) {
		return cryptoRef.randomUUID();
	}

	return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function fileNameOf(filePath: string): string {
	const segment = filePath
		.replace(/[/\\]+$/, "")
		.split(/[/\\]/)
		.pop();

	return segment && segment.length > 0 ? segment : filePath;
}

function toSourceState(source: Source): SourceState {
	return {
		id: source.id,
		name: source.name,
		audioFilePath: source.audioFilePath,
		timelineOffsetMs: Math.max(0, source.timelineOffsetMs),
		layerColor: { primary: source.layerColor.primary, secondary: source.layerColor.secondary },
		visible: source.visible,
		muted: source.muted,
		soloed: source.soloed,
	};
}

export function createSourceFromFile(filePath: string, index: number): SourceState {
	return toSourceState(
		createDefaultSource(index, {
			name: fileNameOf(filePath),
			audioFilePath: filePath,
		}),
	);
}

export function createSavedSession(
	filePaths: ReadonlyArray<string>,
	preferences: Preferences = INITIAL_PREFERENCES,
	theme: ThemeId = "lava",
): SavedSession {
	const session = SavedSessionSchema.parse({
		id: generateId(),
		name: filePaths[0] ? fileNameOf(filePaths[0]).slice(0, 200) : "New Session",
		volume: preferences.monitorVolume,
		playbackRate: preferences.playbackRate,
		viewSettings: { fftSize: preferences.fftSize, hopOverlap: preferences.hopOverlap, spectrogramColormap: theme },
		sources: filePaths.map((filePath, index) => createSourceFromFile(filePath, index)),
		activeView: "overlay",
		channelInput: "mono",
		positionSec: 0,
		selection: null,
		canonicalSampleRate: preferences.sampleRate,
		differenceA: null,
		differenceB: null,
	});

	if (filePaths.length === 0) session.savedFingerprint = sessionFingerprint(session);

	return session;
}

export function createTabId(): string {
	return generateId();
}
