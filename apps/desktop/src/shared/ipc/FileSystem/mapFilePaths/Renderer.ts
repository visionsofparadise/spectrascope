import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface MapFilePathsOptions {
	readonly baseFilePath: string;
	readonly paths: ReadonlyArray<string>;
	readonly mode: "relative" | "absolute";
}
export type MapFilePathsIpcParameters = [options: MapFilePathsOptions];
export type MapFilePathsIpcReturn = Array<string>;
export const MAP_FILE_PATHS_ACTION = "mapFilePaths" as const;
export class MapFilePathsRendererIpc extends AsyncRendererIpc<
	typeof MAP_FILE_PATHS_ACTION,
	MapFilePathsIpcParameters,
	MapFilePathsIpcReturn
> {
	action = MAP_FILE_PATHS_ACTION;
}
