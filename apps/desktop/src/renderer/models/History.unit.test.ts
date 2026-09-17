import { batch, createMutableState, flush, subscribe, type Operation } from "opshot";
import { describe, expect, it } from "vitest";

import { automaticMeta, createHistory, MAX_HISTORY_ENTRIES, replayMeta, type DocumentMeta } from "./History";

interface SourceFixture {
	id: string;
	name: string;
	timelineOffsetMs: number;
	muted: boolean;
	label?: string;
	note: string | undefined;
}

interface DocumentFixture {
	name: string;
	sources: Array<SourceFixture>;
	channelInput: "mono" | "mid" | "side";
	selection: { start: number; end: number } | null;
	canonicalSampleRate: number | null;
	differenceA: string | null;
	differenceB: string | null;
	renderSettings: { spectrogramColormap: "lava" | "viridis"; waveformOpacity: number };
	volume: number;
}

const createSourceFixture = (id: string): SourceFixture => ({
	id,
	name: `Source ${id}`,
	timelineOffsetMs: 0,
	muted: false,
	note: undefined,
});

const createFixture = () => {
	const document = createMutableState<DocumentFixture>({
		name: "New Session",
		sources: [createSourceFixture("a"), createSourceFixture("b"), createSourceFixture("c")],
		channelInput: "mono",
		selection: null,
		canonicalSampleRate: null,
		differenceA: null,
		differenceB: null,
		renderSettings: { spectrogramColormap: "lava", waveformOpacity: 0.8 },
		volume: 1,
	});
	const history = createHistory(document);

	return { document, history };
};

const sourceIdsOf = (document: DocumentFixture) => document.sources.map((source) => source.id);

describe("History", () => {
	it("undoes and redoes a scalar write", () => {
		const { document, history } = createFixture();

		document.volume = 0.5;

		flush(document);

		expect(history.stack).toHaveLength(1);
		expect(history.canUndo).toBe(true);

		history.undo();

		expect(document.volume).toBe(1);
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(true);

		history.redo();

		expect(document.volume).toBe(0.5);
		expect(history.canRedo).toBe(false);
	});

	it("undoes and redoes a nested write", () => {
		const { document, history } = createFixture();

		document.renderSettings.spectrogramColormap = "viridis";

		flush(document);

		history.undo();

		expect(document.renderSettings.spectrogramColormap).toBe("lava");

		history.redo();

		expect(document.renderSettings.spectrogramColormap).toBe("viridis");
	});

	it("undoes and redoes an array splice and push", () => {
		const { document, history } = createFixture();

		document.sources.splice(1, 1);

		flush(document);

		document.sources.push(createSourceFixture("d"));

		flush(document);

		expect(sourceIdsOf(document)).toEqual(["a", "c", "d"]);

		history.undo();

		expect(sourceIdsOf(document)).toEqual(["a", "c"]);
		expect(document.sources).toHaveLength(2);

		history.undo();

		expect(sourceIdsOf(document)).toEqual(["a", "b", "c"]);
		expect(document.sources).toHaveLength(3);

		history.redo();
		history.redo();

		expect(sourceIdsOf(document)).toEqual(["a", "c", "d"]);
	});

	it("undo of an added key removes it and redo restores it", () => {
		const { document, history } = createFixture();
		const [source] = document.sources;

		if (source === undefined) throw new Error("fixture has no source");

		source.label = "Reference";

		flush(document);

		history.undo();

		expect("label" in source).toBe(false);

		history.redo();

		expect(source.label).toBe("Reference");
	});

	it("undo of a key holding undefined keeps the key", () => {
		const { document, history } = createFixture();
		const [source] = document.sources;

		if (source === undefined) throw new Error("fixture has no source");

		source.note = "edited";

		flush(document);

		history.undo();

		expect("note" in source).toBe(true);
		expect(source.note).toBeUndefined();

		history.redo();

		expect(source.note).toBe("edited");
	});

	it("coalesces one key's writes across windows into one entry", () => {
		const { document, history } = createFixture();

		for (const volume of [0.9, 0.7, 0.5, 0.3]) {
			batch(() => {
				document.volume = volume;
			}, "volume-gesture");

			flush(document);
		}

		expect(history.stack).toHaveLength(1);

		history.undo();

		expect(document.volume).toBe(1);
		expect(history.canUndo).toBe(false);
	});

	it("records two keys as two entries", () => {
		const { document, history } = createFixture();

		batch(() => {
			document.volume = 0.5;
		}, "volume-gesture");
		batch(() => {
			document.renderSettings.waveformOpacity = 0.4;
		}, "opacity-gesture");

		flush(document);

		expect(history.stack.map((entry) => entry.transactionKey)).toEqual(["volume-gesture", "opacity-gesture"]);
	});

	it("truncates the redo tail on a new write", () => {
		const { document, history } = createFixture();

		document.name = "First";

		flush(document);

		document.name = "Second";

		flush(document);

		history.undo();

		document.channelInput = "side";

		flush(document);

		expect(history.stack).toHaveLength(2);
		expect(history.canRedo).toBe(false);

		history.undo();

		expect(document.channelInput).toBe("mono");
		expect(document.name).toBe("First");
	});

	it("truncates the redo tail on a resumed key and folds into its entry", () => {
		const { document, history } = createFixture();

		batch(() => {
			document.volume = 0.5;
		}, "volume-gesture");

		flush(document);

		document.name = "Renamed";

		flush(document);

		history.undo();

		batch(() => {
			document.volume = 0.2;
		}, "volume-gesture");

		flush(document);

		expect(history.stack).toHaveLength(1);
		expect(history.canRedo).toBe(false);
		expect(document.name).toBe("New Session");

		history.undo();

		expect(document.volume).toBe(1);
	});

	it("leaves the stack unchanged on replay", () => {
		const { document, history } = createFixture();

		const metas = new Array<DocumentMeta>();
		const unsubscribe = subscribe<DocumentMeta>(document, (operations) => {
			metas.push(...operations.map((operation) => operation.meta));
		});

		document.selection = { start: 0, end: 1000 };

		flush(document);

		history.undo();

		flush(document);
		unsubscribe();

		expect(metas).toEqual([undefined, replayMeta]);
		expect(history.stack).toHaveLength(1);
		expect(history.index).toBe(-1);

		history.redo();

		flush(document);

		expect(history.stack).toHaveLength(1);
		expect(history.index).toBe(0);
	});

	it("leaves the stack and the redo tail unchanged on an automatic write", () => {
		const { document, history } = createFixture();

		document.name = "First";

		flush(document);

		document.name = "Second";

		flush(document);

		history.undo();

		batch(() => {
			document.differenceA = "a";
			document.differenceB = "b";
		}, automaticMeta);

		flush(document);

		expect(history.stack).toHaveLength(2);
		expect(history.index).toBe(0);
		expect(history.canRedo).toBe(true);

		history.redo();

		expect(document.name).toBe("Second");
		expect(document.differenceA).toBe("a");
	});

	it("records a pending write before a command in the same synchronous turn", () => {
		const { document, history } = createFixture();

		document.canonicalSampleRate = 48000;

		flush(document);

		document.canonicalSampleRate = 96000;

		history.undo();

		expect(document.canonicalSampleRate).toBe(48000);
		expect(history.stack).toHaveLength(2);

		history.undo();

		expect(document.canonicalSampleRate).toBeNull();

		document.canonicalSampleRate = 44100;

		history.redo();

		expect(document.canonicalSampleRate).toBe(44100);
		expect(history.stack).toHaveLength(1);
		expect(history.canRedo).toBe(false);
	});

	it("evicts the oldest entry past the bound", () => {
		const { document, history } = createFixture();

		for (let step = 1; step <= MAX_HISTORY_ENTRIES + 1; step++) {
			document.name = `Step ${step}`;

			flush(document);
		}

		expect(history.stack).toHaveLength(MAX_HISTORY_ENTRIES);
		expect(history.length).toBe(MAX_HISTORY_ENTRIES);
		expect(history.index).toBe(MAX_HISTORY_ENTRIES - 1);

		for (let step = 0; step < MAX_HISTORY_ENTRIES; step++) history.undo();

		expect(history.canUndo).toBe(false);
		expect(document.name).toBe("Step 1");
	});

	it("reaches a second subscriber with canUndo and canRedo through length", () => {
		const { document, history } = createFixture();
		const emissions = new Array<ReadonlyArray<Operation<DocumentMeta>>>();
		const unsubscribe = subscribe<DocumentMeta>(history, (operations) => {
			emissions.push(operations);
		});

		batch(() => {
			document.volume = 0.5;
		}, "volume-gesture");

		flush(document);
		flush(history);

		expect(emissions).toHaveLength(1);
		expect(history.canUndo).toBe(true);

		document.name = "Renamed";

		flush(document);

		history.undo();

		flush(history);

		expect(history.canRedo).toBe(true);

		emissions.length = 0;

		batch(() => {
			document.volume = 0.2;
		}, "volume-gesture");

		flush(document);
		flush(history);
		unsubscribe();

		expect(emissions).toHaveLength(1);
		expect(emissions[0]?.map((operation) => operation.key)).toEqual(["length"]);
		expect(history.canRedo).toBe(false);
	});
});
