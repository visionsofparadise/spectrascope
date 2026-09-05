import type { Comparison } from "../models/State/App";
import type { Snapshot } from "valtio/vanilla";

export type ComparisonHistoryState = Omit<Snapshot<Comparison>, "positionSec">;

export type EditKind = "sources" | "view" | "channelInput" | "selection" | "sampleRate" | "difference" | "unknown";

interface HistoryEntry {
	readonly state: ComparisonHistoryState;
	readonly kind: EditKind;
	readonly committedAt: number;
}

export class ComparisonHistory {
	/**
	 * Maximum number of *past* entries retained. When a push would exceed this
	 * the oldest past entry is evicted — undo history is bounded so a long
	 * editing session cannot grow memory without limit.
	 */
	static readonly MAX_PAST_ENTRIES = 100;

	/**
	 * Two same-kind pushes within this many milliseconds coalesce into one entry.
	 * Sized to absorb a rapid gesture (a drag's commits, a held arrow key) as one
	 * step without merging genuinely separate deliberate edits.
	 */
	static readonly COALESCE_WINDOW_MS = 400;

	private readonly _past: Array<HistoryEntry> = [];

	private _current: HistoryEntry;

	private _future: Array<HistoryEntry> = [];

	constructor(initial: ComparisonHistoryState) {
		this._current = { state: initial, kind: "unknown", committedAt: 0 };
	}

	get current(): ComparisonHistoryState {
		return this._current.state;
	}

	get canUndo(): boolean {
		return this._past.length > 0;
	}

	get canRedo(): boolean {
		return this._future.length > 0;
	}

	push(state: ComparisonHistoryState, kind: EditKind, now: number = Date.now()): void {
		if (historyStatesEqual(this._current.state, state)) {
			return;
		}

		this._future = [];

		const entry: HistoryEntry = { state, kind, committedAt: now };

		const canCoalesce =
			this._current.kind !== "unknown" &&
			this._current.kind === kind &&
			now - this._current.committedAt <= ComparisonHistory.COALESCE_WINDOW_MS;

		if (canCoalesce) {
			this._current = entry;

			return;
		}

		this._past.push(this._current);
		this._current = entry;

		if (this._past.length > ComparisonHistory.MAX_PAST_ENTRIES) {
			this._past.shift();
		}
	}

	undo(): ComparisonHistoryState | null {
		const previous = this._past.pop();

		if (previous === undefined) {
			return null;
		}

		this._future.push(this._current);
		this._current = previous;

		return this._current.state;
	}

	redo(): ComparisonHistoryState | null {
		const next = this._future.pop();

		if (next === undefined) {
			return null;
		}

		this._past.push(this._current);
		this._current = next;

		return this._current.state;
	}
}

export function classifyEdit(previous: ComparisonHistoryState, next: ComparisonHistoryState): EditKind {
	const sourcesChanged = previous.sources !== next.sources;
	const viewChanged = previous.activeView !== next.activeView;
	const channelChanged = previous.channelInput !== next.channelInput;
	const selectionChanged = previous.selection !== next.selection;
	const sampleRateChanged = previous.canonicalSampleRate !== next.canonicalSampleRate;
	const differenceChanged = previous.differenceA !== next.differenceA || previous.differenceB !== next.differenceB;

	const changedCount =
		Number(sourcesChanged) +
		Number(viewChanged) +
		Number(channelChanged) +
		Number(selectionChanged) +
		Number(sampleRateChanged) +
		Number(differenceChanged);

	if (changedCount !== 1) {
		return "unknown";
	}

	if (sourcesChanged) return "sources";

	if (viewChanged) return "view";

	if (channelChanged) return "channelInput";

	if (sampleRateChanged) return "sampleRate";

	if (differenceChanged) return "difference";

	return "selection";
}

export function toHistoryState(comparison: Snapshot<Comparison>): ComparisonHistoryState {
	const { positionSec: _positionSec, ...rest } = comparison;

	return rest;
}

function selectionsEqual(
	left: ComparisonHistoryState["selection"],
	right: ComparisonHistoryState["selection"],
): boolean {
	if (left === null || right === null) {
		return left === right;
	}

	return left.start === right.start && left.end === right.end;
}

export function historyStatesEqual(left: ComparisonHistoryState, right: ComparisonHistoryState): boolean {
	if (left === right) {
		return true;
	}

	if (
		left.id !== right.id ||
		left.activeView !== right.activeView ||
		left.channelInput !== right.channelInput ||
		left.canonicalSampleRate !== right.canonicalSampleRate ||
		left.differenceA !== right.differenceA ||
		left.differenceB !== right.differenceB ||
		!selectionsEqual(left.selection, right.selection) ||
		left.sources.length !== right.sources.length
	) {
		return false;
	}

	return left.sources.every((source, index) => {
		const other = right.sources[index];

		return (
			source.id === other?.id &&
			source.name === other.name &&
			source.audioFilePath === other.audioFilePath &&
			source.timelineOffsetMs === other.timelineOffsetMs &&
			source.layerColor.primary === other.layerColor.primary &&
			source.layerColor.secondary === other.layerColor.secondary &&
			source.visible === other.visible &&
			source.muted === other.muted &&
			source.soloed === other.soloed
		);
	});
}
