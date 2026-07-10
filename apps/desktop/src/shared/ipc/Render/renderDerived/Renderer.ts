import type { RenderSpec } from "../../../../main/ffmpeg/renderSpec";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type RenderDerivedIpcParameters = [spec: RenderSpec];
export type RenderDerivedIpcReturn = string;
export const RENDER_DERIVED_ACTION = "renderDerived" as const;

export class RenderDerivedRendererIpc extends AsyncRendererIpc<typeof RENDER_DERIVED_ACTION, RenderDerivedIpcParameters, RenderDerivedIpcReturn> {
	action = RENDER_DERIVED_ACTION;
}
