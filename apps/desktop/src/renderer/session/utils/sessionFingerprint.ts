import type { SavedSession } from "../../models/State/App";
import type { Snapshot } from "valtio/vanilla";

export function sessionContent(comparison: Snapshot<SavedSession>) {
	return {
		name: comparison.name,
		sources: comparison.sources,
		activeView: comparison.activeView,
		channelInput: comparison.channelInput,
		selection: comparison.selection,
		canonicalSampleRate: comparison.canonicalSampleRate,
		differenceA: comparison.differenceA,
		differenceB: comparison.differenceB,
		viewSettings: comparison.viewSettings,
		volume: comparison.volume,
		playbackRate: comparison.playbackRate,
		looping: comparison.looping,
	};
}

export function sessionFingerprint(comparison: Snapshot<SavedSession>): string {
	return JSON.stringify(sessionContent(comparison));
}

export function isSessionDirty(comparison: Snapshot<SavedSession>): boolean {
	return comparison.savedFingerprint !== sessionFingerprint(comparison);
}
