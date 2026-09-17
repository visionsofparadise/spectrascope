import type { SavedSession } from "../../models/State/App";

export function sessionContent(session: SavedSession) {
	return {
		name: session.name,
		sources: session.sources,
		activeView: session.activeView,
		channelInput: session.channelInput,
		selection: session.selection,
		canonicalSampleRate: session.canonicalSampleRate,
		differenceA: session.differenceA,
		differenceB: session.differenceB,
		viewSettings: session.viewSettings,
		volume: session.volume,
		playbackRate: session.playbackRate,
		looping: session.looping,
	};
}

export function sessionFingerprint(session: SavedSession): string {
	return JSON.stringify(sessionContent(session));
}

export function isSessionDirty(session: SavedSession): boolean {
	return session.savedFingerprint !== sessionFingerprint(session);
}
