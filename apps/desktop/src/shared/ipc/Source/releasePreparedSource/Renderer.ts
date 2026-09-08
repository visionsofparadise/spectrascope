import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type ReleasePreparedSourceIpcParameters = [pcmPath: string];
export type ReleasePreparedSourceIpcReturn = undefined;
export const RELEASE_PREPARED_SOURCE_ACTION = "releasePreparedSource" as const;

export class ReleasePreparedSourceRendererIpc extends AsyncRendererIpc<
	typeof RELEASE_PREPARED_SOURCE_ACTION,
	ReleasePreparedSourceIpcParameters,
	ReleasePreparedSourceIpcReturn
> {
	action = RELEASE_PREPARED_SOURCE_ACTION;
}
