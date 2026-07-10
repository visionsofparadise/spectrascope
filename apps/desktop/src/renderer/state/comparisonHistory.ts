import type { Snapshot } from "valtio/vanilla";
import type { Comparison } from "../models/State/App";

/**
 * The history-relevant projection of a comparison — every field of `Comparison`
 * except the purely transient transport playhead (`positionSec`). Undo/redo
 * traverses *edits*; the playhead moving during playback is not an edit, so it
 * is excluded from history (per the Phase 8 design). Restoring an entry writes
 * these fields back and leaves `positionSec` untouched.
 */
export type ComparisonHistoryState = Omit<Snapshot<Comparison>, "positionSec">;

/**
 * A tag describing the *kind* of edit a history entry represents. Consecutive
 * pushes of the same kind within the coalesce window collapse into one entry
 * (e.g. a run of arrow-key timeline nudges, or rapid mute toggles, become a
 * single undo step).
 */
export type EditKind = "sources" | "view" | "channelInput" | "selection" | "unknown";

/** A single committed edit: the comparison state after it, plus its edit kind. */
interface HistoryEntry {
	readonly state: ComparisonHistoryState;
	readonly kind: EditKind;
	/** Unix-ms timestamp the entry was pushed — drives time-windowed coalescing. */
	readonly committedAt: number;
}

/**
 * A bounded undo/redo history of comparison-state snapshots.
 *
 * The history holds `ComparisonHistoryState` values — valtio snapshots are
 * deeply immutable, so retaining one per committed edit is cheap and safe (no
 * copy needed). It is modelled as a *past* stack, a *current* entry, and a
 * *future* stack: `undo()` moves the current entry onto the future stack and
 * promotes the top of the past stack; `redo()` does the reverse. `push()`
 * records a new edit, moving the old current onto the past stack and clearing
 * the future stack (a new edit after an undo discards the abandoned redo
 * branch — the standard undo model).
 *
 * Coalescing: a `push()` whose `kind` matches the current entry's kind and
 * lands within `COALESCE_WINDOW_MS` of it *replaces* the current entry instead
 * of growing the past stack. This collapses a rapid run of same-kind edits — a
 * drag emitting several offset commits, repeated arrow-key nudges — into a
 * single undo step, while distinct edits (or a pause between them) stay
 * separate. The seed entry (kind `unknown`) never coalesces.
 */
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

	/** States reachable by `undo()`, oldest first. */
	private readonly _past: Array<HistoryEntry> = [];

	/** The current comparison state. */
	private _current: HistoryEntry;

	/** States reachable by `redo()`, with the next-redo entry last. */
	private _future: Array<HistoryEntry> = [];

	/** Construct a history seeded with the comparison's current state. */
	constructor(initial: ComparisonHistoryState) {
		this._current = { state: initial, kind: "unknown", committedAt: 0 };
	}

	/** The current comparison state. */
	get current(): ComparisonHistoryState {
		return this._current.state;
	}

	/** Whether there is a prior state to `undo()` to. */
	get canUndo(): boolean {
		return this._past.length > 0;
	}

	/** Whether there is a state to `redo()` to. */
	get canRedo(): boolean {
		return this._future.length > 0;
	}

	/**
	 * Record a new committed edit.
	 *
	 * No-op when `state` is *value-equal* to the current entry across every
	 * undoable field. A reference check would not suffice: callers project a
	 * `Comparison` through `toHistoryState` on every change, which always
	 * allocates a fresh object — so a transport-position-only change (which
	 * `toHistoryState` strips) still yields a new, but value-equal, projection.
	 * Comparing by value keeps such non-edits out of the history. Otherwise the
	 * future stack is cleared, and the edit either coalesces into the current
	 * entry (same kind, within the coalesce window) or becomes a new step — the
	 * old current is pushed onto the past stack, evicting the oldest past entry
	 * if the stack is at `MAX_PAST_ENTRIES`.
	 *
	 * `now` is injectable purely so tests can drive coalescing deterministically;
	 * production callers omit it and get `Date.now()`.
	 */
	push(state: ComparisonHistoryState, kind: EditKind, now: number = Date.now()): void {
		if (historyStatesEqual(this._current.state, state)) {
			return;
		}

		this._future = [];

		const entry: HistoryEntry = { state, kind, committedAt: now };

		// Coalesce when this edit continues a same-kind run within the time
		// window. The seed entry (kind `unknown`, committedAt `0`) is treated as
		// non-coalescible — a real edit always carries a concrete kind, and an
		// `unknown` real edit should still land as its own discrete step.
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

	/**
	 * Step back one edit. Moves the current entry onto the future stack and
	 * promotes the most recent past entry, returning the new current state — or
	 * `null` when there is nothing to undo.
	 */
	undo(): ComparisonHistoryState | null {
		const previous = this._past.pop();

		if (previous === undefined) {
			return null;
		}

		this._future.push(this._current);
		this._current = previous;

		return this._current.state;
	}

	/**
	 * Step forward one edit. Moves the current entry onto the past stack and
	 * promotes the next future entry, returning the new current state — or
	 * `null` when there is nothing to redo.
	 */
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

/**
 * Classify a comparison edit by diffing the previous and next history states.
 * The classification only drives coalescing — it groups a rapid run of the
 * *same* kind of edit (a drag, repeated nudges) into one undo step.
 *
 * - `view` — only `activeView` changed (switching tabs).
 * - `channelInput` — only `channelInput` changed (Mono/Mid/Side).
 * - `selection` — only `selection` changed.
 * - `sources` — the `sources` array changed (add/remove, offset, mute/solo/
 *   visibility, rename, recolor) — the dominant editing channel.
 * - `unknown` — anything else, or several fields at once. `unknown` entries do
 *   not coalesce, so each lands as its own step.
 */
export function classifyEdit(previous: ComparisonHistoryState, next: ComparisonHistoryState): EditKind {
	const sourcesChanged = previous.sources !== next.sources;
	const viewChanged = previous.activeView !== next.activeView;
	const channelChanged = previous.channelInput !== next.channelInput;
	const selectionChanged = previous.selection !== next.selection;

	const changedCount =
		Number(sourcesChanged) + Number(viewChanged) + Number(channelChanged) + Number(selectionChanged);

	if (changedCount !== 1) {
		return "unknown";
	}

	if (sourcesChanged) return "sources";
	if (viewChanged) return "view";
	if (channelChanged) return "channelInput";

	return "selection";
}

/**
 * Project a comparison snapshot onto its history-relevant state — everything
 * except the transient transport playhead. Used both to seed a history and to
 * detect history-relevant changes.
 */
export function toHistoryState(comparison: Snapshot<Comparison>): ComparisonHistoryState {
	const { positionSec: _positionSec, ...rest } = comparison;

	return rest;
}

/** Value-equality of two `selection` fields (time-range or `null`). */
function selectionsEqual(
	left: ComparisonHistoryState["selection"],
	right: ComparisonHistoryState["selection"],
): boolean {
	if (left === null || right === null) {
		return left === right;
	}

	return left.start === right.start && left.end === right.end;
}

/**
 * Deep value-equality of two history states across every *undoable* field —
 * the `sources` list (and each source's fields), `activeView`, `channelInput`,
 * and `selection`.
 *
 * `positionSec` is not a field of `ComparisonHistoryState` (`toHistoryState`
 * strips it), so it is structurally excluded. This is the no-op test
 * `ComparisonHistory.push` uses: callers re-project a `Comparison` on every
 * change and always allocate a fresh object, so a reference check would never
 * fire — a transport-position-only change would push a spurious entry. Value
 * equality makes such a non-edit a genuine no-op.
 */
export function historyStatesEqual(left: ComparisonHistoryState, right: ComparisonHistoryState): boolean {
	if (left === right) {
		return true;
	}

	if (
		left.id !== right.id ||
		left.activeView !== right.activeView ||
		left.channelInput !== right.channelInput ||
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
