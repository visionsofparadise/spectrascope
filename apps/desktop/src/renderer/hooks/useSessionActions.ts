import { identify } from "opshot";
import { useMemo, useRef } from "react";
import { createSession, savedSessionOf } from "../models/State/Session";
import { AUDIO_FILE_EXTENSIONS, createSavedSession, createTabId } from "../session/createSavedSession";
import { addRecentSession, sessionPathKey } from "../session/utils/recentSessions";
import { openSessionFile, saveSessionFile } from "../session/utils/sessionFiles";
import { sessionFingerprint, isSessionDirty } from "../session/utils/sessionFingerprint";
import type { SessionStatus } from "../models/Context";
import type { Main } from "../models/Main";
import type { AppState, SavedSession } from "../models/State/App";

export interface SessionActions {
	openSession: (filePath?: string) => Promise<void>;
	newSession: () => Promise<void>;
	saveSession: (saveAs?: boolean) => Promise<boolean>;
	closeSession: (tabId: string) => Promise<void>;
	renameTab: (tabId: string, name: string) => void;
	removeRecentSession: (filePath: string) => void;
}

const SESSION_FILTERS = [{ name: "Spectrascope session", extensions: ["spectra"] }];

export function useSessionActions(app: AppState, sessionStatus: SessionStatus, main: Main): SessionActions {
	const operation = useRef(false);

	return useMemo(() => {
		const run = async <T>(action: () => Promise<T>, fallback: T): Promise<T> => {
			if (operation.current) return fallback;

			operation.current = true;
			sessionStatus.busy = true;
			sessionStatus.error = null;

			try {
				return await action();
			} catch (cause) {
				sessionStatus.error = cause instanceof Error ? cause.message : String(cause);

				return fallback;
			} finally {
				operation.current = false;
				sessionStatus.busy = false;
			}
		};
		const sessionOf = (id: string | undefined) => app.sessions.find((entry) => entry.id === id);
		const openTab = (saved: SavedSession): void => {
			const id = createTabId();

			app.sessions.push(createSession(saved));
			app.tabs.push({ id, sessionId: saved.id });
			app.activeTabId = id;
		};
		const remember = (filePath: string, name: string): void => {
			app.recentSessions = addRecentSession(app.recentSessions, filePath, name);
		};
		const save = async (id: string, saveAs = false): Promise<boolean> => {
			let session = sessionOf(id);

			if (!session) return false;

			const chosen =
				saveAs || session.file.path === null
					? await main.showSaveDialog({
							title: "Save Session",
							defaultPath: session.file.path ?? `${session.document.name.replace(/[<>:"/\\|?*]/g, "_")}.spectra`,
							filters: SESSION_FILTERS,
						})
					: session.file.path;

			if (!chosen) return false;

			const filePath =
				(await main.mapFilePaths({ baseFilePath: chosen, paths: [chosen], mode: "absolute" }))[0] ?? chosen;

			if (!filePath.toLowerCase().endsWith(".spectra"))
				throw new Error("Use the .spectra extension when saving a session.");

			if (
				app.sessions.some(
					(entry) =>
						entry.id !== id &&
						entry.file.path !== null &&
						sessionPathKey(entry.file.path) === sessionPathKey(filePath),
				)
			)
				throw new Error("That session is open in another tab. Choose a different file.");

			session = sessionOf(id);

			if (!session) return false;

			if (
				app.sessions.some((entry) =>
					entry.document.sources.some(
						(source) => source.audioFilePath && sessionPathKey(source.audioFilePath) === sessionPathKey(filePath),
					),
				)
			) {
				throw new Error("Choose a session file that does not overwrite source audio.");
			}

			const saved = savedSessionOf(session);

			await saveSessionFile(main, saved, filePath);
			session.file.path = filePath;
			session.file.savedFingerprint = sessionFingerprint(saved);
			remember(filePath, saved.name);

			return true;
		};

		return {
			newSession: () =>
				run(() => {
					openTab(createSavedSession([], app.preferences, app.theme));

					return Promise.resolve();
				}, undefined),
			openSession: (requested) =>
				run(async () => {
					const paths = requested
						? [requested]
						: await main.showOpenDialog({
								title: "Open Session or Audio",
								filters: [...SESSION_FILTERS, { name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
								properties: ["openFile"],
							});
					const chosen = paths?.[0];

					if (!chosen) return;

					if (AUDIO_FILE_EXTENSIONS.some((extension) => chosen.toLowerCase().endsWith(`.${extension}`))) {
						openTab(createSavedSession([chosen], app.preferences, app.theme));

						return;
					}

					const filePath =
						(await main.mapFilePaths({ baseFilePath: chosen, paths: [chosen], mode: "absolute" }))[0] ?? chosen;
					const existing = app.sessions.find(
						(entry) => entry.file.path !== null && sessionPathKey(entry.file.path) === sessionPathKey(filePath),
					);
					const tab = existing && app.tabs.find((entry) => entry.sessionId === existing.id);

					if (tab) {
						app.activeTabId = tab.id;
						remember(filePath, existing.document.name);

						return;
					}

					const saved = await openSessionFile(main, filePath);

					openTab(saved);
					remember(filePath, saved.name);
				}, undefined),
			saveSession: (saveAs) =>
				run(async () => {
					const id = app.tabs.find((entry) => entry.id === app.activeTabId)?.sessionId;

					return id ? save(id, saveAs) : false;
				}, false),
			closeSession: (tabId) =>
				run(async () => {
					const tab = app.tabs.find((entry) => entry.id === tabId);

					if (!tab) return;

					const { sessionId } = tab;
					const session = sessionOf(sessionId);

					if (session && isSessionDirty(savedSessionOf(session))) {
						const response = await main.showMessageBox({
							type: "question",
							title: "Close Session",
							message: `Save changes to ${session.document.name}?`,
							buttons: ["Save", "Discard", "Cancel"],
							defaultId: 0,
							cancelId: 2,
						});

						if (response === 2) return;

						if (response === 0 && (!(await save(session.id)) || isSessionDirty(savedSessionOf(session)))) return;

						if (response !== 0 && response !== 1) return;
					}

					const index = app.tabs.findIndex((entry) => entry.id === tabId);
					const sessionIndex = app.sessions.findIndex((entry) => entry.id === sessionId);

					app.tabs.splice(index, 1);

					if (sessionIndex >= 0) app.sessions.splice(sessionIndex, 1);

					if (app.activeTabId === tabId) app.activeTabId = app.tabs[index]?.id ?? app.tabs[index - 1]?.id ?? null;
				}, undefined),
			renameTab: (tabId, name) => {
				const session = sessionOf(app.tabs.find((entry) => entry.id === tabId)?.sessionId);

				if (session && name.trim()) session.document.name = name.trim().slice(0, 200);
			},
			removeRecentSession: (filePath) => {
				app.recentSessions = app.recentSessions.filter(
					(entry) => sessionPathKey(entry.filePath) !== sessionPathKey(filePath),
				);
			},
		};
	}, [identify(app), identify(sessionStatus), main]);
}
