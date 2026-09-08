import { dialog } from "electron";
import { assertExportDestination, exportFileName } from "../../../../main/export/exportFile";
import { resolveExportRange, writeStreamExport } from "../../../../main/export/exportStream";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { EXPORT_STREAM_ACTION, type ExportStreamIpcParameters, type ExportStreamIpcReturn } from "./Renderer";
import type { ExportStreamOptions } from "../../../models/Export";

export class ExportStreamMainIpc extends AsyncMainIpc<ExportStreamIpcParameters, ExportStreamIpcReturn> {
	action = EXPORT_STREAM_ACTION;

	async handler(options: ExportStreamOptions, dependencies: IpcHandlerDependencies): Promise<ExportStreamIpcReturn> {
		if (!["wav", "csv"].includes(options.kind)) throw new Error("Unsupported export format.");

		const lease = await dependencies.streamManager.acquire(options.key);

		if (!lease) throw new Error("This stream is no longer available. Prepare the audio and try exporting again.");

		try {
			resolveExportRange(lease.resolved, options);

			const result = await dialog.showSaveDialog(dependencies.browserWindow, {
				title: options.kind === "wav" ? "Export audio" : "Export waveform measurements",
				defaultPath: exportFileName(options.suggestedName, options.kind),
				filters: [
					{
						name: options.kind === "wav" ? "Float32 WAV audio" : "Waveform measurements CSV",
						extensions: [options.kind],
					},
				],
			});

			if (result.canceled || !result.filePath) return null;

			await assertExportDestination(result.filePath, [
				...options.protectedPaths,
				...lease.resolved.spec.inputs.map((input) => input.pcmPath),
			]);
			await writeStreamExport(result.filePath, lease.resolved, options);

			return result.filePath;
		} finally {
			lease.release();
		}
	}
}
