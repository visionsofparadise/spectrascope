import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";
import type { ExportStreamOptions } from "../../../models/Export";

export const EXPORT_STREAM_ACTION = "exportStream" as const;
export type ExportStreamIpcParameters = [options: ExportStreamOptions];
export type ExportStreamIpcReturn = string | null;

export class ExportStreamRendererIpc extends AsyncRendererIpc<
	typeof EXPORT_STREAM_ACTION,
	ExportStreamIpcParameters,
	ExportStreamIpcReturn
> {
	action = EXPORT_STREAM_ACTION;
}
