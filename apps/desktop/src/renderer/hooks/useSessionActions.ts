import { useMemo, useRef, useState } from "react";
import { snapshot, type Snapshot } from "valtio/vanilla";
import { AUDIO_FILE_EXTENSIONS, createComparison, createTabId } from "../comparison/createComparison";
import { comparisonFingerprint, isComparisonDirty } from "../comparison/utils/comparisonFingerprint";
import { addRecentSession, sessionPathKey } from "../comparison/utils/recentSessions";
import { openSessionFile, saveSessionFile } from "../comparison/utils/sessionFiles";
import type { Main } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState, Comparison } from "../models/State/App";

export interface SessionActions {
	openComparison: (filePath?: string) => Promise<void>;
	newComparison: () => Promise<void>;
	importAudio: () => Promise<void>;
	saveComparison: (saveAs?: boolean) => Promise<boolean>;
	closeComparison: (tabId: string) => Promise<void>;
	renameTab: (tabId: string, name: string) => void;
	removeRecentSession: (filePath: string) => void;
	busy: boolean;
	error: string | null;
	clearError: () => void;
}

const SESSION_FILTERS = [{ name: "Spectrascope session", extensions: ["spectra"] }];

export function useSessionActions(app: Snapshot<AppState>, store: ProxyStore, main: Main): SessionActions {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const operation = useRef(false);

	return useMemo(() => {
		const current = (): AppState => {
			const proxy = store.dangerouslyGetProxy<AppState>(app._key);

			if (!proxy) throw new Error("Workspace is unavailable");

			return proxy;
		};
		const run = async <T>(action: () => Promise<T>, fallback: T): Promise<T> => {
			if (operation.current) return fallback;

			operation.current = true;
			setBusy(true);
			setError(null);

			try {
				return await action();
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : String(cause));

				return fallback;
			} finally {
				operation.current = false;
				setBusy(false);
			}
		};
		const openTab = (comparison: Comparison): void => {
			const state = current();
			const id = createTabId();

			state.comparisons.push(comparison);
			state.tabs.push({ id, comparisonId: comparison.id });
			state.activeTabId = id;
		};
		const remember = (filePath: string, name: string): void => {
			const state = current();

			state.recentSessions = addRecentSession(state.recentSessions, filePath, name);
		};
		const save = async (id: string, saveAs = false): Promise<boolean> => {
			let comparison = current().comparisons.find((entry) => entry.id === id);

			if (!comparison) return false;

			const chosen =
				saveAs || comparison.sessionFilePath === null
					? await main.showSaveDialog({
							title: "Save Session",
							defaultPath:
								comparison.sessionFilePath ?? `${comparison.name.replace(/[<>:"/\\|?*]/g, "_")}.spectra`,
							filters: SESSION_FILTERS,
						})
					: comparison.sessionFilePath;

			if (!chosen) return false;

			const filePath =
				(await main.mapFilePaths({ baseFilePath: chosen, paths: [chosen], mode: "absolute" }))[0] ?? chosen;

			if (!filePath.toLowerCase().endsWith(".spectra"))
				throw new Error("Use the .spectra extension when saving a session.");

			if (
				current().comparisons.some(
					(entry) =>
						entry.id !== id &&
						entry.sessionFilePath !== null &&
						sessionPathKey(entry.sessionFilePath) === sessionPathKey(filePath),
				)
			)
				throw new Error("That session is open in another tab. Choose a different file.");

			comparison = current().comparisons.find((entry) => entry.id === id);

			if (!comparison) return false;

			if (
				current().comparisons.some((entry) =>
					entry.sources.some(
						(source) => source.audioFilePath && sessionPathKey(source.audioFilePath) === sessionPathKey(filePath),
					),
				)
			) {
				throw new Error("Choose a session file that does not overwrite source audio.");
			}

			const saved = snapshot(comparison);

			await saveSessionFile(main, saved, filePath);
			comparison.sessionFilePath = filePath;
			comparison.savedFingerprint = comparisonFingerprint(saved);
			remember(filePath, saved.name);

			return true;
		};

		return {
			busy,
			error,
			clearError: () => setError(null),
			newComparison: () =>
				run(() => {
					openTab(createComparison([], current().preferences));

					return Promise.resolve();
				}, undefined),
			importAudio: () =>
				run(async () => {
					const paths = await main.showOpenDialog({
						title: "Import Audio",
						filters: [{ name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
						properties: ["openFile", "multiSelections"],
					});

					if (paths?.length) openTab(createComparison(paths, current().preferences));
				}, undefined),
			openComparison: (requested) =>
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
						openTab(createComparison([chosen], current().preferences));

						return;
					}

					const filePath =
						(await main.mapFilePaths({ baseFilePath: chosen, paths: [chosen], mode: "absolute" }))[0] ?? chosen;
					const existing = current().comparisons.find(
						(entry) =>
							entry.sessionFilePath !== null &&
							sessionPathKey(entry.sessionFilePath) === sessionPathKey(filePath),
					);
					const tab = existing && current().tabs.find((entry) => entry.comparisonId === existing.id);

					if (tab) {
						current().activeTabId = tab.id;
						remember(filePath, existing.name);

						return;
					}

					const comparison = await openSessionFile(main, filePath);

					openTab(comparison);
					remember(filePath, comparison.name);
				}, undefined),
			saveComparison: (saveAs) =>
				run(async () => {
					const state = current();
					const id = state.tabs.find((entry) => entry.id === state.activeTabId)?.comparisonId;

					return id ? save(id, saveAs) : false;
				}, false),
			closeComparison: (tabId) =>
				run(async () => {
					const state = current();
					const tab = state.tabs.find((entry) => entry.id === tabId);

					if (!tab) return;

					const comparison = state.comparisons.find((entry) => entry.id === tab.comparisonId);

					if (comparison && isComparisonDirty(comparison)) {
						const response = await main.showMessageBox({
							type: "question",
							title: "Close Session",
							message: `Save changes to ${comparison.name}?`,
							buttons: ["Save", "Discard", "Cancel"],
							defaultId: 0,
							cancelId: 2,
						});

						if (response === 2) return;

						if (response === 0 && (!(await save(comparison.id)) || isComparisonDirty(comparison))) return;

						if (response !== 0 && response !== 1) return;
					}

					const index = state.tabs.findIndex((entry) => entry.id === tabId);

					state.tabs.splice(index, 1);
					state.comparisons = state.comparisons.filter((entry) => entry.id !== tab.comparisonId);

					if (state.activeTabId === tabId)
						state.activeTabId = state.tabs[index]?.id ?? state.tabs[index - 1]?.id ?? null;
				}, undefined),
			renameTab: (tabId, name) => {
				const state = current();
				const id = state.tabs.find((entry) => entry.id === tabId)?.comparisonId;
				const comparison = state.comparisons.find((entry) => entry.id === id);

				if (comparison && name.trim()) comparison.name = name.trim().slice(0, 200);
			},
			removeRecentSession: (filePath) => {
				const state = current();

				state.recentSessions = state.recentSessions.filter(
					(entry) => sessionPathKey(entry.filePath) !== sessionPathKey(filePath),
				);
			},
		};
	}, [app._key, store, main, busy, error]);
}
