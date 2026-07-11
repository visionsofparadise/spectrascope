import type { Snapshot } from "valtio/vanilla";
import { describe, expect, it } from "vitest";
import type { Comparison } from "../models/State/App";
import type { ComparisonHistoryState } from "./comparisonHistory";
import { ComparisonHistory, classifyEdit, historyStatesEqual, toHistoryState } from "./comparisonHistory";

/**
 * A shared empty `sources` reference. `classifyEdit` diffs `sources` by
 * reference (mirroring valtio, which yields a fresh reference only on a real
 * change), so unrelated `makeState` calls must reuse the *same* empty array —
 * otherwise every state would read as a `sources` edit.
 */
const EMPTY_SOURCES: ComparisonHistoryState["sources"] = [];

/**
 * Build a history state. `sources` defaults to a shared reference; an explicit
 * `overrides.sources` (a new array) reads as a `sources` change. The whole
 * object is always a fresh reference, matching `push`'s value-equality check
 * against real valtio snapshots.
 */
function makeState(overrides: Partial<ComparisonHistoryState> = {}): ComparisonHistoryState {
	return {
		id: "comparison-1",
		sources: EMPTY_SOURCES,
		activeView: "overlay",
		channelInput: "mono",
		selection: null,
		canonicalSampleRate: null,
		differenceA: null,
		differenceB: null,
		...overrides,
	};
}

/** Build one source with all fields concrete, so per-source value equality can be exercised. */
function makeSource(overrides: Partial<ComparisonHistoryState["sources"][number]> = {}): ComparisonHistoryState["sources"][number] {
	return {
		id: "source-1",
		name: "Take 1",
		audioFilePath: "/audio/take-1.wav",
		timelineOffsetMs: 0,
		layerColor: { primary: "#ff0000", secondary: "#00ff00" },
		visible: true,
		muted: false,
		soloed: false,
		...overrides,
	};
}

/**
 * Build a full `Comparison` snapshot (including the transient `positionSec`) —
 * the input shape `toHistoryState` projects from. Used to prove a
 * `positionSec`-only change projects to a value-equal history state.
 */
function makeComparison(overrides: Partial<Comparison> = {}): Snapshot<Comparison> {
	return {
		id: "comparison-1",
		sources: [],
		activeView: "overlay",
		channelInput: "mono",
		positionSec: 0,
		selection: null,
		canonicalSampleRate: null,
		differenceA: null,
		differenceB: null,
		...overrides,
	};
}

describe("ComparisonHistory", () => {
	it("undo/redo traverses pushed edits and restores the right states", () => {
		const initial = makeState();
		const history = new ComparisonHistory(initial);

		const afterA = makeState({ activeView: "sum" });
		const afterB = makeState({ activeView: "timeline" });

		// Two distinct-kind edits well outside the coalesce window.
		history.push(afterA, "view", 1_000);
		history.push(afterB, "channelInput", 5_000);

		expect(history.current).toBe(afterB);
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);

		expect(history.undo()).toBe(afterA);
		expect(history.undo()).toBe(initial);
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(true);

		expect(history.redo()).toBe(afterA);
		expect(history.redo()).toBe(afterB);
		expect(history.canRedo).toBe(false);
	});

	it("returns null and does not move when undo/redo run past the ends of history", () => {
		const history = new ComparisonHistory(makeState());

		expect(history.undo()).toBeNull();
		expect(history.redo()).toBeNull();
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
	});

	it("ignores a push whose state is reference-identical to the current entry", () => {
		const initial = makeState();
		const history = new ComparisonHistory(initial);

		history.push(initial, "view", 1_000);

		expect(history.canUndo).toBe(false);
	});

	it("ignores a push whose state is a distinct object but value-equal to the current entry", () => {
		// A fresh object — not reference-identical — but every undoable field
		// matches. `toHistoryState` always allocates, so this is what a
		// transport-position-only comparison change looks like to `push`: it must
		// not create a history entry.
		const history = new ComparisonHistory(makeState());

		history.push(makeState(), "unknown", 1_000);

		expect(history.canUndo).toBe(false);
	});

	it("ignores a push when only per-source values match across distinct source arrays", () => {
		// Two distinct `sources` arrays holding distinct source objects whose
		// fields are all equal — a reference check would treat this as an edit.
		const initial = makeState({ sources: [makeSource()] });
		const history = new ComparisonHistory(initial);

		history.push(makeState({ sources: [makeSource()] }), "sources", 1_000);

		expect(history.canUndo).toBe(false);
	});

	it("clears the redo stack when a new edit is pushed after an undo", () => {
		const history = new ComparisonHistory(makeState());
		const afterA = makeState({ activeView: "sum" });

		history.push(afterA, "view", 1_000);
		history.undo();

		expect(history.canRedo).toBe(true);

		history.push(makeState({ activeView: "slider" }), "view", 5_000);

		// The abandoned redo branch is discarded — the standard undo model.
		expect(history.canRedo).toBe(false);
	});

	it("coalesces same-kind edits inside the coalesce window into one entry", () => {
		const history = new ComparisonHistory(makeState());

		// Three same-kind edits each within COALESCE_WINDOW_MS of the previous —
		// a held arrow-key nudge or a drag emitting several offset commits.
		history.push(makeState({ activeView: "sum" }), "view", 1_000);
		history.push(makeState({ activeView: "timeline" }), "view", 1_200);
		const last = makeState({ activeView: "slider" });
		history.push(last, "view", 1_400);

		expect(history.current).toBe(last);

		// One undo unwinds the whole coalesced run back to the seed state.
		expect(history.undo()?.activeView).toBe("overlay");
		expect(history.canUndo).toBe(false);
	});

	it("does not coalesce same-kind edits separated by more than the window", () => {
		const history = new ComparisonHistory(makeState());

		history.push(makeState({ activeView: "sum" }), "view", 1_000);
		// Past the window — a deliberate separate edit, its own undo step.
		history.push(makeState({ activeView: "timeline" }), "view", 1_000 + ComparisonHistory.COALESCE_WINDOW_MS + 1);

		expect(history.undo()?.activeView).toBe("sum");
		expect(history.undo()?.activeView).toBe("overlay");
	});

	it("does not coalesce edits of differing kinds even within the window", () => {
		const history = new ComparisonHistory(makeState());

		history.push(makeState({ activeView: "sum" }), "view", 1_000);
		history.push(makeState({ channelInput: "mid" }), "channelInput", 1_100);

		// Distinct kinds — two separate undo steps despite being inside the window.
		expect(history.canUndo).toBe(true);
		expect(history.undo()?.activeView).toBe("sum");
		expect(history.undo()).not.toBeNull();
	});

	it("never coalesces the first edit into the unknown-kind seed entry", () => {
		const history = new ComparisonHistory(makeState());

		// The seed entry has kind `unknown`; a real first edit must land as its
		// own step so it remains undoable back to the seed.
		history.push(makeState({ activeView: "sum" }), "unknown", 1);

		expect(history.canUndo).toBe(true);
		expect(history.undo()?.activeView).toBe("overlay");
	});

	it("evicts the oldest entry once the past stack exceeds MAX_PAST_ENTRIES", () => {
		const history = new ComparisonHistory(makeState({ channelInput: "mono" }));

		// Push one more than the cap, each a distinct non-coalescing step
		// (alternating kinds keep them from merging). The oldest past entries
		// fall off; only MAX_PAST_ENTRIES undos remain reachable.
		const total = ComparisonHistory.MAX_PAST_ENTRIES + 5;

		for (let index = 0; index < total; index += 1) {
			const kind = index % 2 === 0 ? "view" : "channelInput";

			history.push(makeState({ channelInput: "side", activeView: index % 2 === 0 ? "sum" : "overlay" }), kind, index * 10_000);
		}

		let undoCount = 0;

		while (history.undo() !== null) {
			undoCount += 1;
		}

		expect(undoCount).toBe(ComparisonHistory.MAX_PAST_ENTRIES);
	});
});

describe("classifyEdit", () => {
	const base = makeState();

	it("classifies a lone sources change as a sources edit", () => {
		expect(classifyEdit(base, makeState({ sources: [] }))).toBe("sources");
	});

	it("classifies a lone view change as a view edit", () => {
		expect(classifyEdit(base, makeState({ activeView: "sum" }))).toBe("view");
	});

	it("classifies a lone channel-input change as a channelInput edit", () => {
		expect(classifyEdit(base, makeState({ channelInput: "side" }))).toBe("channelInput");
	});

	it("classifies a lone canonical-sample-rate change as a sampleRate edit", () => {
		expect(classifyEdit(base, makeState({ canonicalSampleRate: 48000 }))).toBe("sampleRate");
	});

	it("classifies a Difference A/B change (both fields at once) as one difference edit", () => {
		// The default-difference write sets differenceA and differenceB together;
		// counted as a single dimension so it stays one undo step.
		expect(classifyEdit(base, makeState({ differenceA: "source-1", differenceB: "source-2" }))).toBe("difference");
	});

	it("classifies multiple simultaneous field changes as unknown", () => {
		const next = makeState({ activeView: "sum", channelInput: "mid" });

		expect(classifyEdit(base, next)).toBe("unknown");
	});

	it("classifies no observable change as unknown", () => {
		// Same field references throughout — nothing changed.
		expect(classifyEdit(base, base)).toBe("unknown");
	});
});

describe("historyStatesEqual", () => {
	it("treats two distinct-but-value-equal states as equal", () => {
		// Distinct top-level objects with distinct `sources` arrays and distinct
		// source objects — only value equality, never reference equality, can
		// make these compare equal.
		const a = makeState({ sources: [makeSource()], selection: { start: 1, end: 2 } });
		const b = makeState({ sources: [makeSource()], selection: { start: 1, end: 2 } });

		expect(historyStatesEqual(a, b)).toBe(true);
	});

	it("detects a change in any undoable field", () => {
		const base = makeState({ sources: [makeSource()], selection: { start: 1, end: 2 } });

		expect(historyStatesEqual(base, makeState({ ...base, activeView: "sum" }))).toBe(false);
		expect(historyStatesEqual(base, makeState({ ...base, channelInput: "mid" }))).toBe(false);
		expect(historyStatesEqual(base, makeState({ ...base, selection: { start: 1, end: 3 } }))).toBe(false);
		expect(historyStatesEqual(base, makeState({ ...base, selection: null }))).toBe(false);
		expect(historyStatesEqual(base, makeState({ ...base, sources: [makeSource(), makeSource({ id: "source-2" })] }))).toBe(false);
		expect(historyStatesEqual(base, makeState({ ...base, sources: [makeSource({ muted: true })] }))).toBe(false);
		expect(historyStatesEqual(base, makeState({ ...base, sources: [makeSource({ timelineOffsetMs: 50 })] }))).toBe(false);
	});

	it("treats a transport-position-only comparison change as a value-equal projection", () => {
		// The bug: a pause/seek/view-switch commits a new `comparison` snapshot
		// that differs only in `positionSec`. `toHistoryState` strips it, so the
		// two projections must be value-equal — no history entry, no enabled undo.
		const before = toHistoryState(makeComparison({ positionSec: 0 }));
		const after = toHistoryState(makeComparison({ positionSec: 42 }));

		expect(historyStatesEqual(before, after)).toBe(true);

		const history = new ComparisonHistory(before);

		history.push(after, classifyEdit(before, after), 1_000);

		expect(history.canUndo).toBe(false);
	});
});
