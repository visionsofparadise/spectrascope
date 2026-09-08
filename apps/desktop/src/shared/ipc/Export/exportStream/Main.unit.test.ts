import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportStreamMainIpc } from "./Main";
import type { IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import type { ExportStreamOptions } from "../../../models/Export";

const mocks = vi.hoisted(() => ({ save: vi.fn(), validate: vi.fn(), write: vi.fn(), range: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showSaveDialog: mocks.save } }));
vi.mock("../../../../main/export/exportFile", () => ({
	assertExportDestination: mocks.validate,
	exportFileName: () => "Session.wav",
}));
vi.mock("../../../../main/export/exportStream", () => ({
	resolveExportRange: mocks.range,
	writeStreamExport: mocks.write,
}));

const options: ExportStreamOptions = {
	key: "stream",
	kind: "wav",
	suggestedName: "Session",
	protectedPaths: ["source.wav", "session.spectra"],
};

function fixture() {
	const release = vi.fn();
	const resolved = { spec: { inputs: [{ pcmPath: "cached.wav" }] } };
	const acquire = vi.fn().mockResolvedValue({ release, resolved });
	const dependencies = { streamManager: { acquire }, browserWindow: {} } as unknown as IpcHandlerDependencies;
	return { release, resolved, acquire, dependencies };
}

describe("stream export IPC", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});
	it("pins before the dialog and releases on cancellation", async () => {
		const { dependencies, acquire, release } = fixture();
		mocks.save.mockImplementation(() => {
			expect(acquire).toHaveBeenCalledWith("stream");
			expect(release).not.toHaveBeenCalled();
			return { canceled: true };
		});
		expect(await new ExportStreamMainIpc().handler(options, dependencies)).toBeNull();
		expect(release).toHaveBeenCalledTimes(1);
		expect(mocks.write).not.toHaveBeenCalled();
	});
	it("adds every leased PCM path to the protected source paths and holds through writing", async () => {
		const { dependencies, resolved, release } = fixture();
		mocks.save.mockResolvedValue({ canceled: false, filePath: "output.wav" });
		mocks.write.mockImplementation(() => {
			expect(release).not.toHaveBeenCalled();
		});
		expect(await new ExportStreamMainIpc().handler(options, dependencies)).toBe("output.wav");
		expect(mocks.validate).toHaveBeenCalledWith("output.wav", ["source.wav", "session.spectra", "cached.wav"]);
		expect(mocks.write).toHaveBeenCalledWith("output.wav", resolved, options);
		expect(release).toHaveBeenCalledTimes(1);
	});
	it.each(["range", "save", "validate", "write"] as const)("releases after a %s failure", async (step) => {
		const { dependencies, release } = fixture();
		mocks.save.mockResolvedValue({ canceled: false, filePath: "output.wav" });
		mocks[step].mockImplementation(() => {
			throw new Error("failure");
		});
		await expect(new ExportStreamMainIpc().handler(options, dependencies)).rejects.toThrow("failure");
		expect(release).toHaveBeenCalledTimes(1);
	});
	it("reports a missing stream before showing a dialog", async () => {
		const { dependencies, acquire } = fixture();
		acquire.mockResolvedValue(null);
		await expect(new ExportStreamMainIpc().handler(options, dependencies)).rejects.toThrow("no longer available");
		expect(mocks.save).not.toHaveBeenCalled();
	});
});
