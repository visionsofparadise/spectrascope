import { createMutableState } from "opshot";
import { expect, it, vi } from "vitest";
import { mapFilePaths } from "../../main/utils/mapFilePaths";
import { createSavedSession } from "../session/createSavedSession";
import { isSessionDirty } from "../session/utils/sessionFingerprint";
import { serializeSession } from "../session/utils/sessionDocument";
import { createAppState, INITIAL_PREFERENCES } from "../models/State/App";
import { savedSessionOf } from "../models/State/Session";
import { useSessionActions } from "./useSessionActions";
import type { SessionStatus } from "../models/Context";
import type { Main } from "../models/Main";
import type { Session } from "../models/State/Session";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useMemo: (factory: () => unknown) => factory(),
	useRef: (value: unknown) => ({ current: value }),
}));

const isDirty = (session: Session) => isSessionDirty(savedSessionOf(session));

function setup() {
	const saved = createSavedSession(["C:/audio/a.wav"]);
	const app = createMutableState(
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
	const sessionStatus = createMutableState<SessionStatus>({ busy: false, error: null });
	const main = {
		mapFilePaths: vi
			.fn()
			.mockImplementation((options: Parameters<typeof mapFilePaths>[0]) => Promise.resolve(mapFilePaths(options))),
		showSaveDialog: vi.fn().mockResolvedValue("C:/sessions/test.spectra"),
		showMessageBox: vi.fn().mockResolvedValue(0),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue(serializeSession(saved, ["../audio/a.wav"])),
		showOpenDialog: vi.fn().mockResolvedValue(undefined),
	};
	const actions = useSessionActions(app, sessionStatus, main as unknown as Main);
	return { app, main, actions };
}

it("saves a snapshot baseline and preserves edits arriving during the write", async () => {
	const { app, main, actions } = setup();
	let finish = (): void => undefined;
	main.writeFile.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const saving = actions.saveSession();
	await vi.waitFor(() => expect(main.writeFile).toHaveBeenCalled());
	app.sessions[0]!.document.name = "Changed while saving";
	finish();
	expect(await saving).toBe(true);
	expect(isDirty(app.sessions[0]!)).toBe(true);
	expect(app.recentSessions).toHaveLength(1);
	expect(JSON.parse(main.writeFile.mock.calls[0]![1] as string).comparison.name).toBe("a.wav");
});

it("cancel and failed save retain the dirty tab; Discard closes and removes its session", async () => {
	const { app, main, actions } = setup();
	main.showSaveDialog.mockResolvedValueOnce(undefined);
	await actions.closeSession("tab");
	expect(app.tabs).toHaveLength(1);
	main.writeFile.mockRejectedValueOnce(new Error("disk full"));
	await actions.closeSession("tab");
	expect(app.tabs).toHaveLength(1);
	expect(app.sessions[0]?.file.savedFingerprint).toBeNull();
	main.showMessageBox.mockResolvedValueOnce(2);
	await actions.closeSession("tab");
	expect(app.tabs).toHaveLength(1);
	main.showMessageBox.mockResolvedValueOnce(1);
	await actions.closeSession("tab");
	expect(app.tabs).toHaveLength(0);
	expect(app.sessions).toHaveLength(0);
});

it("activates an already-open path without replacing its unsaved edits", async () => {
	const { app, main, actions } = setup();
	await actions.saveSession();
	app.sessions[0]!.document.name = "Unsaved name";
	app.activeTabId = null;
	await actions.openSession("c:/sessions/test.spectra");
	expect(app.activeTabId).toBe("tab");
	expect(app.sessions).toHaveLength(1);
	expect(app.sessions[0]?.document.name).toBe("Unsaved name");
	expect(main.readFile).not.toHaveBeenCalled();
});

it("rejects malformed open without mutating current tabs and serializes manual operations", async () => {
	const { app, main, actions } = setup();
	main.readFile.mockResolvedValueOnce("bad");
	await actions.openSession("C:/sessions/bad.spectra");
	expect(app.tabs).toHaveLength(1);
	let finish = (): void => undefined;
	main.writeFile.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const saving = actions.saveSession();
	await vi.waitFor(() => expect(main.writeFile).toHaveBeenCalled());
	expect(await actions.saveSession()).toBe(false);
	expect(main.writeFile).toHaveBeenCalledTimes(1);
	finish();
	await saving;
});

it("keeps edits that arrive while a close-triggered save is writing", async () => {
	const { app, main, actions } = setup();
	let finish = (): void => undefined;
	main.writeFile.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const closing = actions.closeSession("tab");
	await vi.waitFor(() => expect(main.writeFile).toHaveBeenCalled());
	app.sessions[0]!.document.volume = 0.3;
	finish();
	await closing;
	expect(app.tabs).toHaveLength(1);
	expect(isDirty(app.sessions[0]!)).toBe(true);
});

it("protects source audio against accidental session overwrite", async () => {
	const { main, actions } = setup();
	main.showSaveDialog.mockResolvedValueOnce("C:/audio/a.wav");
	expect(await actions.saveSession()).toBe(false);
	expect(main.writeFile).not.toHaveBeenCalled();
});

it("applies changed preferences only to newly created sessions", async () => {
	const { app, actions } = setup();
	app.preferences.monitorVolume = 0.2;
	app.preferences.fftSize = 8192;
	app.preferences.sampleRate = 44100;
	await actions.newSession();
	expect(app.sessions[0]?.document.volume).toBe(1);
	expect(app.sessions[1]?.document.volume).toBe(0.2);
	expect(app.sessions[1]?.document.renderSettings.fftSize).toBe(8192);
	expect(app.sessions[1]?.document.canonicalSampleRate).toBe(44100);
});
