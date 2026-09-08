import { z } from "zod";
import { mapFilePaths } from "../../../../main/utils/mapFilePaths";
import { AsyncMainIpc } from "../../../models/AsyncMainIpc";
import {
	MAP_FILE_PATHS_ACTION,
	type MapFilePathsIpcParameters,
	type MapFilePathsIpcReturn,
	type MapFilePathsOptions,
} from "./Renderer";

const OptionsSchema = z.object({
	baseFilePath: z.string().min(1),
	paths: z.array(z.string()),
	mode: z.enum(["relative", "absolute"]),
});

export class MapFilePathsMainIpc extends AsyncMainIpc<MapFilePathsIpcParameters, MapFilePathsIpcReturn> {
	action = MAP_FILE_PATHS_ACTION;
	handler(options: MapFilePathsOptions): Promise<MapFilePathsIpcReturn> {
		return Promise.resolve(mapFilePaths(OptionsSchema.parse(options)));
	}
}
