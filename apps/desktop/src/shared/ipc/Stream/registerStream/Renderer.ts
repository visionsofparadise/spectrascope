import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";
import type { StreamSpec } from "../../../../main/audio/streamDsp";
import type { StreamInfo } from "../../../../main/StreamManager";

export type RegisterStreamIpcParameters = [spec: StreamSpec];
export type RegisterStreamIpcReturn = StreamInfo;
export const REGISTER_STREAM_ACTION = "registerStream" as const;

export class RegisterStreamRendererIpc extends AsyncRendererIpc<
	typeof REGISTER_STREAM_ACTION,
	RegisterStreamIpcParameters,
	RegisterStreamIpcReturn
> {
	action = REGISTER_STREAM_ACTION;
}
