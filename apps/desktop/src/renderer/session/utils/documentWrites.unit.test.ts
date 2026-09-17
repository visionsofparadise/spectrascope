import { flush } from "opshot";
import { describe, expect, it } from "vitest";
import { automaticMeta } from "../../models/History";
import { createSession } from "../../models/State/Session";
import { createSavedSession } from "../createSavedSession";
import { appendSources, removeSource, selectRange, setDifference } from "./documentWrites";
import type { SessionContext } from "../../models/Context";

function contextFixture() {
	const saved = createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav", "C:/audio/c.wav"]);
	const session = createSession({
		...saved,
		differenceA: saved.sources[0]?.id ?? null,
		differenceB: saved.sources[1]?.id ?? null,
	});

	return { session, context: { session } as unknown as SessionContext };
}

describe("document writes", () => {
	it("appends sources as one history entry", () => {
		const { session, context } = contextFixture();

		appendSources(["C:/audio/d.wav", "D:/e.flac"], context);
		flush(session.document);

		expect(session.document.sources.map((source) => source.name)).toEqual([
			"a.wav",
			"b.wav",
			"c.wav",
			"d.wav",
			"e.flac",
		]);
		expect(session.history.length).toBe(1);
	});

	it("removes a source and clears the difference id naming it in one history entry", () => {
		const { session, context } = contextFixture();
		const [first, second] = session.document.sources.map((source) => source.id);

		removeSource(second!, context);
		flush(session.document);

		expect(session.document.sources.map((source) => source.id)).not.toContain(second);
		expect(session.document.differenceA).toBe(first);
		expect(session.document.differenceB).toBeNull();
		expect(session.history.length).toBe(1);

		session.history.undo();
		flush(session.document);

		expect(session.document.sources.map((source) => source.id)).toContain(second);
		expect(session.document.differenceB).toBe(second);
	});

	it("leaves the document alone when removing an unknown source", () => {
		const { session, context } = contextFixture();

		removeSource("missing", context);
		flush(session.document);

		expect(session.document.sources).toHaveLength(3);
		expect(session.history.length).toBe(0);
	});

	it("normalizes a selected range and loops over it", () => {
		const { session, context } = contextFixture();

		selectRange({ start: 900, end: -100 }, 500, context);
		flush(session.document, session.transport);

		expect(session.document.selection).toEqual({ start: 0, end: 500 });
		expect(session.transport.looping).toBe(true);

		session.transport.looping = false;
		selectRange(null, 500, context);
		flush(session.document, session.transport);

		expect(session.document.selection).toBeNull();
		expect(session.transport.looping).toBe(false);
	});

	it("records a picked difference pair", () => {
		const { session, context } = contextFixture();
		const [, second, third] = session.document.sources.map((source) => source.id);

		setDifference(third!, second!, undefined, context);
		flush(session.document);

		expect([session.document.differenceA, session.document.differenceB]).toEqual([third, second]);
		expect(session.history.length).toBe(1);
	});

	it("keeps an automatic difference pair out of history", () => {
		const session = createSession(createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]));
		const context = { session } as unknown as SessionContext;
		const [first, second] = session.document.sources.map((source) => source.id);

		setDifference(first!, second!, automaticMeta, context);
		flush(session.document);

		expect([session.document.differenceA, session.document.differenceB]).toEqual([first, second]);
		expect(session.history.length).toBe(0);
	});
});
