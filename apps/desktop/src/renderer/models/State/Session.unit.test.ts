import { createMutableState, flush, subscribe } from "opshot";
import { describe, expect, it } from "vitest";
import { createSavedSession } from "../../session/createSavedSession";
import { sessionFingerprint } from "../../session/utils/sessionFingerprint";
import { createAppState, INITIAL_PREFERENCES, SavedSessionSchema, SavedStateSchema, savedStateOf } from "./App";
import { createSession, savedSessionOf } from "./Session";
import type { DocumentState, FileState, NavigationState, TransportState } from "./Session";

function savedFixture() {
	const created = createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]);

	return SavedSessionSchema.parse({
		...created,
		name: "Fixture",
		viewSettings: { ...created.viewSettings, gridOpacity: 0.5, frequencyRange: { top: 0.2, bottom: 0.6 } },
		volume: 0.4,
		playbackRate: 1.5,
		looping: true,
		sessionFilePath: "C:/sessions/fixture.spectra",
		activeView: "timeline",
		channelInput: "side",
		positionSec: 3,
		selection: { start: 100, end: 900 },
		canonicalSampleRate: 48000,
		differenceA: created.sources[0]?.id ?? null,
		differenceB: created.sources[1]?.id ?? null,
	});
}

function appFixture() {
	const saved = savedFixture();

	return createMutableState(
		createAppState({
			tabs: [{ id: "tab", comparisonId: saved.id }],
			activeTabId: "tab",
			theme: "lava",
			windowBounds: undefined,
			comparisons: [saved],
			preferences: { ...INITIAL_PREFERENCES },
			recentSessions: [],
		}),
	);
}

describe("Session", () => {
	it("composes the saved record it was created from", () => {
		const saved = { ...savedFixture(), savedFingerprint: "stored" };

		expect(savedSessionOf(createSession(saved))).toEqual(SavedSessionSchema.parse(saved));
	});

	it("keeps the fingerprint of the saved record through the round trip", () => {
		const saved = savedFixture();

		expect(sessionFingerprint(savedSessionOf(createSession(saved)))).toBe(sessionFingerprint(saved));
	});

	it("reaches app subscribers with a document write", () => {
		const app = appFixture();
		const session = app.sessions[0]!;
		const heard = new Array<string>();

		subscribe(app, (operations) => {
			heard.push(...operations.map((operation) => `${operation.kind}:${operation.key}`));
		});
		session.document.name = "Renamed";
		flush(session.document, app);

		expect(heard).toContain("change:name");
	});

	it("records only document writes in history", () => {
		const session = createSession(savedFixture());
		const transport: TransportState = { looping: false, playbackRate: 2, positionSec: 9 };
		const navigation: NavigationState = { activeView: "overlay", frequencyRange: { top: 0, bottom: 1 } };
		const file: FileState = { path: null, savedFingerprint: "edited" };
		const document: Partial<DocumentState> = { volume: 1 };

		Object.assign(session.transport, transport);
		Object.assign(session.navigation, navigation);
		Object.assign(session.file, file);
		flush(session.transport, session.navigation, session.file, session.document);

		expect(session.history.length).toBe(0);

		Object.assign(session.document, document);
		flush(session.document);

		expect(session.history.length).toBe(1);
	});

	it("composes the persisted state keys", () => {
		const app = appFixture();
		const saved = savedStateOf(app);
		const parsed = SavedStateSchema.parse(JSON.parse(JSON.stringify(saved)));

		expect(Object.keys(saved)).toContain("comparisons");
		expect(parsed.tabs).toEqual([{ id: "tab", comparisonId: app.sessions[0]!.id }]);
		expect(parsed.comparisons?.[0]).toEqual(savedSessionOf(app.sessions[0]!));
	});

	it("stops reaching app subscribers once its session is spliced out", () => {
		const app = appFixture();
		const { document } = app.sessions[0]!;
		let heard = 0;

		app.sessions.splice(0, 1);
		flush(app);
		subscribe(app, (operations) => {
			heard += operations.length;
		});
		document.name = "Closed";
		flush(document, app);

		expect(heard).toBe(0);
	});
});
