import { createDefaultSource } from "../workspace/source";
import type { Source } from "../workspace/source";
import type { Comparison, SourceState } from "../models/State/App";

/** Audio file extensions offered in the open dialog. */
export const AUDIO_FILE_EXTENSIONS = ["wav", "mp3", "flac", "m4a", "ogg", "aiff"] as const;

/**
 * Generate a stable id. Prefers `crypto.randomUUID` (available in the Electron
 * renderer); falls back to a Math.random based string only in environments
 * without WebCrypto (test runners).
 */
function generateId(): string {
	const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;

	if (cryptoRef?.randomUUID) {
		return cryptoRef.randomUUID();
	}

	return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/** The trailing path segment of an absolute file path (the file name). */
function fileNameOf(filePath: string): string {
	const segment = filePath
		.replace(/[/\\]+$/, "")
		.split(/[/\\]/)
		.pop();

	return segment && segment.length > 0 ? segment : filePath;
}

/**
 * Build a serializable `SourceState` for an imported audio file. The
 * design-system `createDefaultSource` picks the round-robin `layerColor` for
 * `index`; the file path becomes both `audioFilePath` and (via its file name)
 * the source `name`. The result is the persisted mirror shape — plain data,
 * no PCM, no functions.
 */
export function createSourceFromFile(filePath: string, index: number): SourceState {
	const source = createDefaultSource(index, {
		name: fileNameOf(filePath),
		audioFilePath: filePath,
	});

	return {
		id: source.id,
		name: source.name,
		audioFilePath: source.audioFilePath,
		timelineOffsetMs: source.timelineOffsetMs,
		layerColor: { primary: source.layerColor.primary, secondary: source.layerColor.secondary },
		visible: source.visible,
		muted: source.muted,
		soloed: source.soloed,
	};
}

/**
 * Build a fresh `Comparison` from a list of chosen audio file paths — one
 * `Source` per file, round-robin `layerColor`, all defaults otherwise. An
 * empty `filePaths` yields an empty comparison (the "New" flow).
 */
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

/** Build a unique tab id. */
export function createTabId(): string {
	return generateId();
}

/**
 * Detect the `SourcesPanel`'s bare "Add Source" click. The panel is a
 * controlled design-system component: its built-in add affordance appends a
 * `createDefaultSource` row with an empty `audioFilePath` via `onChange`. A
 * comparison source must reference a real file, so that bare addition is
 * intercepted (in `Comparison.tsx`) and replaced with the file-open dialog. The
 * signature of a bare add is: exactly one extra source, appended at the end,
 * with no file path — every preceding source unchanged (same id, same order).
 */
export function isBareAddSource(
	current: ReadonlyArray<Source>,
	next: ReadonlyArray<Source>,
): boolean {
	if (next.length !== current.length + 1) return false;

	const added = next[next.length - 1];

	if (!added || added.audioFilePath.length > 0) return false;

	return current.every((source, index) => source.id === next[index]?.id);
}
