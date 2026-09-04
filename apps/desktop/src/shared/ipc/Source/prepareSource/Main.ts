import { probeAudioFile } from "../../../../main/audio/probe";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { PREPARE_SOURCE_ACTION, type PrepareSourceIpcParameters, type PrepareSourceIpcReturn } from "./Renderer";

export class PrepareSourceMainIpc extends AsyncMainIpc<PrepareSourceIpcParameters, PrepareSourceIpcReturn> {
	action = PREPARE_SOURCE_ACTION;

	async handler(
		filePath: string,
		targetSampleRate: number | null,
		dependencies: IpcHandlerDependencies,
	): Promise<PrepareSourceIpcReturn> {
		const rate = targetSampleRate ?? (await probeAudioFile(filePath)).sampleRate;

		return dependencies.sourceCacheManager.prepare(filePath, rate);
	}
}
