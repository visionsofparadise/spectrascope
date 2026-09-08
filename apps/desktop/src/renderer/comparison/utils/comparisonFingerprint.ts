import type { Comparison } from "../../models/State/App";
import type { Snapshot } from "valtio/vanilla";

export function comparisonContent(comparison: Snapshot<Comparison>) {
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
		syncEnabled: comparison.syncEnabled,
	};
}

export function comparisonFingerprint(comparison: Snapshot<Comparison>): string {
	return JSON.stringify(comparisonContent(comparison));
}

export function isComparisonDirty(comparison: Snapshot<Comparison>): boolean {
	return comparison.savedFingerprint !== comparisonFingerprint(comparison);
}
