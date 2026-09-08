import { dialog } from "electron";
import { assertExportDestination, exportFileName } from "../../../../main/export/exportFile";
import { writeFileAtomically } from "../../../../main/utils/writeFileAtomically";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { EXPORT_IMAGE_ACTION, type ExportImageIpcParameters, type ExportImageIpcReturn } from "./Renderer";
import type { ExportImageOptions } from "../../../models/Export";

export class ExportImageMainIpc extends AsyncMainIpc<ExportImageIpcParameters, ExportImageIpcReturn> {
	action = EXPORT_IMAGE_ACTION;

	async handler(options: ExportImageOptions, dependencies: IpcHandlerDependencies): Promise<ExportImageIpcReturn> {
		const rect = options.rect;

		if (
			!Object.values(rect).every(Number.isFinite) ||
			rect.width <= 0 ||
			rect.height <= 0 ||
			rect.x < 0 ||
			rect.y < 0
		)
			throw new Error("The inspection pane is unavailable for image export.");

		const image = await dependencies.browserWindow.webContents.capturePage({
			x: Math.round(rect.x),
			y: Math.round(rect.y),
			width: Math.max(1, Math.round(rect.width)),
			height: Math.max(1, Math.round(rect.height)),
		});

		if (image.isEmpty()) throw new Error("The inspection image could not be captured.");

		const result = await dialog.showSaveDialog(dependencies.browserWindow, {
			title: "Export inspection image",
			defaultPath: exportFileName(options.suggestedName, "png"),
			filters: [{ name: "PNG image", extensions: ["png"] }],
		});

		if (result.canceled || !result.filePath) return null;

		await assertExportDestination(result.filePath, options.protectedPaths);
		await writeFileAtomically(result.filePath, image.toPNG());

		return result.filePath;
	}
}
