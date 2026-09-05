import { createDefaultSource } from "../workspace/source";
import type { Comparison, SourceState } from "../models/State/App";
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

export function toSourceState(source: Source): SourceState {
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

export function createComparison(filePaths: ReadonlyArray<string>): Comparison {
	return {
		id: generateId(),
		sources: filePaths.map((filePath, index) => createSourceFromFile(filePath, index)),
		activeView: "overlay",
		channelInput: "mono",
		positionSec: 0,
		selection: null,
		canonicalSampleRate: null,
		differenceA: null,
		differenceB: null,
	};
}

export function createTabId(): string {
	return generateId();
}

export function isBareAddSource(current: ReadonlyArray<Source>, next: ReadonlyArray<Source>): boolean {
	if (next.length !== current.length + 1) return false;

	const added = next[next.length - 1];

	if (!added || added.audioFilePath.length > 0) return false;

	return current.every((source, index) => source.id === next[index]?.id);
}
