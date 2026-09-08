import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";
import type { ExportImageOptions } from "../../../models/Export";

export const EXPORT_IMAGE_ACTION = "exportImage" as const;
export type ExportImageIpcParameters = [options: ExportImageOptions];
export type ExportImageIpcReturn = string | null;

export class ExportImageRendererIpc extends AsyncRendererIpc<
	typeof EXPORT_IMAGE_ACTION,
	ExportImageIpcParameters,
	ExportImageIpcReturn
> {
	action = EXPORT_IMAGE_ACTION;
}
