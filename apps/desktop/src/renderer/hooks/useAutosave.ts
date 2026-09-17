import { identify, subscribe } from "opshot";
import { useEffect } from "react";
import { savedStateOf, type AppState } from "../models/State/App";
import type { Main } from "../models/Main";

const DEBOUNCE_MS = 500;

export function useAutosave(app: AppState, main: Main, userDataPath: string): void {
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let pendingData: string | null = null;

		function flush(): void {
			if (pendingData !== null) {
				const data = pendingData;

				pendingData = null;
				void main.writeFile(`${userDataPath}/state.json`, data);
			}
		}

		const unsubscribe = subscribe(app, () => {
			pendingData = JSON.stringify(savedStateOf(app), null, 2);

			if (timer !== null) clearTimeout(timer);

			timer = setTimeout(() => {
				timer = null;
				flush();
			}, DEBOUNCE_MS);
		});

		const onBeforeUnload = (): void => {
			flush();
		};

		window.addEventListener("beforeunload", onBeforeUnload);

		return () => {
			unsubscribe();
			window.removeEventListener("beforeunload", onBeforeUnload);

			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}

			flush();
		};
	}, [identify(app), main, userDataPath]);
}
