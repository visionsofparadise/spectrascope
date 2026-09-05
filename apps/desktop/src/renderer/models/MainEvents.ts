import EventEmitter from "events";
import type { Main } from "./Main";
import type { MainEventMap } from "../../shared/utilities/emitToRenderer";
import type { IpcRendererEvent } from "electron";

export class MainEvents extends EventEmitter<MainEventMap> {
	constructor(main: Main) {
		super();

		main.events.on("windowBoundsChanged", (_: IpcRendererEvent, ...args) => {
			this.emit("windowBoundsChanged", ...args);
		});

		main.events.on("file:changed", (_: IpcRendererEvent, ...args) => {
			this.emit("file:changed", ...args);
		});
	}
}
