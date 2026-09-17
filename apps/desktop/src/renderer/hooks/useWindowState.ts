import { identify } from "opshot";
import { useEffect } from "react";
import type { Main } from "../models/Main";
import type { MainEvents } from "../models/MainEvents";
import type { AppState, WindowBounds } from "../models/State/App";

export function useWindowState(app: AppState, main: Main, mainEvents: MainEvents): void {
	useEffect(() => {
		if (app.windowBounds) {
			const { x, y, width, height } = app.windowBounds;

			void main.getAllDisplays().then((displays) => {
				const isVisible = displays.some(
					(display) =>
						x < display.x + display.width &&
						x + width > display.x &&
						y < display.y + display.height &&
						y + height > display.y,
				);

				if (isVisible) {
					void main.setBounds({ x, y, width, height });
				}
			});
		}

		const listener = (windowBounds: WindowBounds): void => {
			app.windowBounds = windowBounds;
		};

		mainEvents.on("windowBoundsChanged", listener);

		return () => {
			mainEvents.off("windowBoundsChanged", listener);
		};
	}, [identify(app), main, mainEvents]);
}
