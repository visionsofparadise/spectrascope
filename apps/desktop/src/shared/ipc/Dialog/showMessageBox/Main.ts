import { dialog } from "electron";
import { z } from "zod";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import {
	SHOW_MESSAGE_BOX_ACTION,
	type ShowMessageBoxIpcParameters,
	type ShowMessageBoxIpcReturn,
	type ShowMessageBoxOptions,
} from "./Renderer";

const OptionsSchema = z.object({
	type: z.enum(["none", "info", "error", "question", "warning"]).optional(),
	title: z.string(),
	message: z.string(),
	detail: z.string().optional(),
	buttons: z.array(z.string()).min(1),
	defaultId: z.number().int().nonnegative().optional(),
	cancelId: z.number().int().nonnegative().optional(),
});

export class ShowMessageBoxMainIpc extends AsyncMainIpc<ShowMessageBoxIpcParameters, ShowMessageBoxIpcReturn> {
	action = SHOW_MESSAGE_BOX_ACTION;
	async handler(options: ShowMessageBoxOptions, dependencies: IpcHandlerDependencies): Promise<number> {
		return (await dialog.showMessageBox(dependencies.browserWindow, OptionsSchema.parse(options))).response;
	}
}
