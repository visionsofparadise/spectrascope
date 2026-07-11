import type { StreamSpec } from "../../../../main/audio/streamDsp";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { REGISTER_STREAM_ACTION, type RegisterStreamIpcParameters, type RegisterStreamIpcReturn } from "./Renderer";

export class RegisterStreamMainIpc extends AsyncMainIpc<RegisterStreamIpcParameters, RegisterStreamIpcReturn> {
	action = REGISTER_STREAM_ACTION;

	async handler(spec: StreamSpec, dependencies: IpcHandlerDependencies): Promise<RegisterStreamIpcReturn> {
		return dependencies.streamManager.registerStream(spec);
	}
}
