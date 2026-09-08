import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import {
	RELEASE_PREPARED_SOURCE_ACTION,
	type ReleasePreparedSourceIpcParameters,
	type ReleasePreparedSourceIpcReturn,
} from "./Renderer";

export class ReleasePreparedSourceMainIpc extends AsyncMainIpc<
	ReleasePreparedSourceIpcParameters,
	ReleasePreparedSourceIpcReturn
> {
	action = RELEASE_PREPARED_SOURCE_ACTION;

	handler(pcmPath: string, dependencies: IpcHandlerDependencies): Promise<undefined> {
		dependencies.sourceCacheManager.releasePreparedSource(pcmPath);

		return Promise.resolve(undefined);
	}
}
