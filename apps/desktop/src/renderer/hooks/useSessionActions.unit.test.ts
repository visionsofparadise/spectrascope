import { proxy, snapshot } from "valtio/vanilla";
import { expect, it, vi } from "vitest";
import { mapFilePaths } from "../../main/utils/mapFilePaths";
import { createComparison } from "../comparison/createComparison";
import { isComparisonDirty } from "../comparison/utils/comparisonFingerprint";
import { serializeSession } from "../comparison/utils/sessionDocument";
import { ProxyStore } from "../models/ProxyStore/ProxyStore";
import { INITIAL_PREFERENCES, type AppState } from "../models/State/App";
import { useSessionActions } from "./useSessionActions";
import type { Main } from "../models/Main";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useMemo: (factory: () => unknown) => factory(),
	useRef: (value: unknown) => ({ current: value }),
	useState: (value: unknown) => [value, vi.fn()],
}));

function setup() {
	const comparison = createComparison(["C:/audio/a.wav"]);
	const app = proxy<AppState>({
		_key: Symbol(),
		tabs: [{ id: "tab", comparisonId: comparison.id }],
		activeTabId: "tab",
		theme: "lava",
		comparisons: [comparison],
		preferences: { ...INITIAL_PREFERENCES },
		recentSessions: [],
	});
	const store = new ProxyStore();
	store.dangerouslySetProxy(app._key, app);
	const main = {
		mapFilePaths: vi
			.fn()
			.mockImplementation((options: Parameters<typeof mapFilePaths>[0]) => Promise.resolve(mapFilePaths(options))),
		showSaveDialog: vi.fn().mockResolvedValue("C:/sessions/test.spectra"),
		showMessageBox: vi.fn().mockResolvedValue(0),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue(serializeSession(comparison, ["../audio/a.wav"])),
		showOpenDialog: vi.fn().mockResolvedValue(undefined),
	};
	const actions = useSessionActions(snapshot(app), store, main as unknown as Main);
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
	const saving = actions.saveComparison();
	await vi.waitFor(() => expect(main.writeFile).toHaveBeenCalled());
	app.comparisons[0]!.name = "Changed while saving";
	finish();
	expect(await saving).toBe(true);
	expect(isComparisonDirty(app.comparisons[0]!)).toBe(true);
	expect(app.recentSessions).toHaveLength(1);
	expect(JSON.parse(main.writeFile.mock.calls[0]![1] as string).comparison.name).toBe("a.wav");
});

it("cancel and failed save retain the dirty tab; Discard closes and removes its comparison", async () => {
	const { app, main, actions } = setup();
	main.showSaveDialog.mockResolvedValueOnce(undefined);
	await actions.closeComparison("tab");
	expect(app.tabs).toHaveLength(1);
	main.writeFile.mockRejectedValueOnce(new Error("disk full"));
	await actions.closeComparison("tab");
	expect(app.tabs).toHaveLength(1);
	expect(app.comparisons[0]?.savedFingerprint).toBeNull();
	main.showMessageBox.mockResolvedValueOnce(2);
	await actions.closeComparison("tab");
	expect(app.tabs).toHaveLength(1);
	main.showMessageBox.mockResolvedValueOnce(1);
	await actions.closeComparison("tab");
	expect(app.tabs).toHaveLength(0);
	expect(app.comparisons).toHaveLength(0);
});

it("activates an already-open path without replacing its unsaved edits", async () => {
	const { app, main, actions } = setup();
	await actions.saveComparison();
	app.comparisons[0]!.name = "Unsaved name";
	app.activeTabId = null;
	await actions.openComparison("c:/sessions/test.spectra");
	expect(app.activeTabId).toBe("tab");
	expect(app.comparisons).toHaveLength(1);
	expect(app.comparisons[0]?.name).toBe("Unsaved name");
	expect(main.readFile).not.toHaveBeenCalled();
});

it("rejects malformed open without mutating current tabs and serializes manual operations", async () => {
	const { app, main, actions } = setup();
	main.readFile.mockResolvedValueOnce("bad");
	await actions.openComparison("C:/sessions/bad.spectra");
	expect(app.tabs).toHaveLength(1);
	let finish = (): void => undefined;
	main.writeFile.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const saving = actions.saveComparison();
	await vi.waitFor(() => expect(main.writeFile).toHaveBeenCalled());
	expect(await actions.saveComparison()).toBe(false);
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
	const closing = actions.closeComparison("tab");
	await vi.waitFor(() => expect(main.writeFile).toHaveBeenCalled());
	app.comparisons[0]!.volume = 0.3;
	finish();
	await closing;
	expect(app.tabs).toHaveLength(1);
	expect(isComparisonDirty(app.comparisons[0]!)).toBe(true);
});

it("protects source audio against accidental session overwrite", async () => {
	const { main, actions } = setup();
	main.showSaveDialog.mockResolvedValueOnce("C:/audio/a.wav");
	expect(await actions.saveComparison()).toBe(false);
	expect(main.writeFile).not.toHaveBeenCalled();
});

it("applies changed preferences only to newly created comparisons", async () => {
	const { app, actions } = setup();
	app.preferences.monitorVolume = 0.2;
	app.preferences.fftSize = 8192;
	app.preferences.sampleRate = 44100;
	await actions.newComparison();
	expect(app.comparisons[0]?.volume).toBe(0.8);
	expect(app.comparisons[1]?.volume).toBe(0.2);
	expect(app.comparisons[1]?.viewSettings.fftSize).toBe(8192);
	expect(app.comparisons[1]?.canonicalSampleRate).toBe(44100);
});
