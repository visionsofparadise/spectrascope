import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";
import type { PreparedSource } from "../../../../main/SourceCacheManager";

export type PrepareSourceIpcParameters = [filePath: string, targetSampleRate: number | null];
export type PrepareSourceIpcReturn = PreparedSource;
export const PREPARE_SOURCE_ACTION = "prepareSource" as const;

export class PrepareSourceRendererIpc extends AsyncRendererIpc<
	typeof PREPARE_SOURCE_ACTION,
	PrepareSourceIpcParameters,
	PrepareSourceIpcReturn
> {
	action = PREPARE_SOURCE_ACTION;
}
