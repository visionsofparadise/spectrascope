import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type ReleaseStreamIpcParameters = [key: string];
export type ReleaseStreamIpcReturn = undefined;
export const RELEASE_STREAM_ACTION = "releaseStream" as const;

export class ReleaseStreamRendererIpc extends AsyncRendererIpc<
	typeof RELEASE_STREAM_ACTION,
	ReleaseStreamIpcParameters,
	ReleaseStreamIpcReturn
> {
	action = RELEASE_STREAM_ACTION;
}
