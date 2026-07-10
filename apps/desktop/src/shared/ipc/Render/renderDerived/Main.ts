import type { RenderSpec } from "../../../../main/ffmpeg/renderSpec";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { RENDER_DERIVED_ACTION, type RenderDerivedIpcParameters, type RenderDerivedIpcReturn } from "./Renderer";

export class RenderDerivedMainIpc extends AsyncMainIpc<RenderDerivedIpcParameters, RenderDerivedIpcReturn> {
	action = RENDER_DERIVED_ACTION;

	async handler(spec: RenderSpec, dependencies: IpcHandlerDependencies): Promise<RenderDerivedIpcReturn> {
		return dependencies.renderManager.render(spec);
	}
}
