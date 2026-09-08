import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportImageMainIpc } from "./Main";
import type { IpcHandlerDependencies } from "../../../models/AsyncMainIpc";

const mocks = vi.hoisted(() => ({ save: vi.fn(), validate: vi.fn(), write: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showSaveDialog: mocks.save } }));
vi.mock("../../../../main/export/exportFile", () => ({
	assertExportDestination: mocks.validate,
	exportFileName: () => "Session.png",
}));
vi.mock("../../../../main/utils/writeFileAtomically", () => ({ writeFileAtomically: mocks.write }));

describe("image export IPC", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});
	it("captures before opening a native dialog and protects inputs before writing", async () => {
		const png = Buffer.from("png");
		const capturePage = vi.fn().mockResolvedValue({ isEmpty: () => false, toPNG: () => png });
		const dependencies = { browserWindow: { webContents: { capturePage } } } as unknown as IpcHandlerDependencies;
		mocks.save.mockImplementation(() => {
			expect(capturePage).toHaveBeenCalled();
			return { canceled: false, filePath: "output.png" };
		});
		const options = {
			rect: { x: 0, y: 48, width: 800, height: 600 },
			suggestedName: "Session",
			protectedPaths: ["source.png"],
		};
		expect(await new ExportImageMainIpc().handler(options, dependencies)).toBe("output.png");
		expect(mocks.validate).toHaveBeenCalledWith("output.png", ["source.png"]);
		expect(mocks.write).toHaveBeenCalledWith("output.png", png);
	});
	it("rejects empty or invalid rectangles before capture", async () => {
		const dependencies = {} as IpcHandlerDependencies;
		await expect(
			new ExportImageMainIpc().handler(
				{ rect: { x: 0, y: 0, width: 0, height: 1 }, suggestedName: "Session", protectedPaths: [] },
				dependencies,
			),
		).rejects.toThrow();
		expect(mocks.save).not.toHaveBeenCalled();
	});
});
