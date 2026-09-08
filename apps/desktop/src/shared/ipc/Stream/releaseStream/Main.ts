import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { RELEASE_STREAM_ACTION, type ReleaseStreamIpcParameters, type ReleaseStreamIpcReturn } from "./Renderer";

export class ReleaseStreamMainIpc extends AsyncMainIpc<ReleaseStreamIpcParameters, ReleaseStreamIpcReturn> {
	action = RELEASE_STREAM_ACTION;

	handler(key: string, dependencies: IpcHandlerDependencies): Promise<undefined> {
		dependencies.streamManager.releaseStream(key);

		return Promise.resolve(undefined);
	}
}
