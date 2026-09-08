import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface ShowMessageBoxOptions {
	readonly type?: "none" | "info" | "error" | "question" | "warning";
	readonly title: string;
	readonly message: string;
	readonly detail?: string;
	readonly buttons: Array<string>;
	readonly defaultId?: number;
	readonly cancelId?: number;
}
export type ShowMessageBoxIpcParameters = [options: ShowMessageBoxOptions];
export type ShowMessageBoxIpcReturn = number;
export const SHOW_MESSAGE_BOX_ACTION = "showMessageBox" as const;
export class ShowMessageBoxRendererIpc extends AsyncRendererIpc<
	typeof SHOW_MESSAGE_BOX_ACTION,
	ShowMessageBoxIpcParameters,
	ShowMessageBoxIpcReturn
> {
	action = SHOW_MESSAGE_BOX_ACTION;
}
