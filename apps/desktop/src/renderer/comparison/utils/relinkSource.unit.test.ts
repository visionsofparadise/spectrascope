import { expect, it, vi } from "vitest";
import { createSourceFromFile } from "../createComparison";
import { relinkSource } from "./relinkSource";

it("validates at the native rate, releases preparation, and retains placement and identity", async () => {
	const source = createSourceFromFile("/missing.wav", 0);
	source.timelineOffsetMs = 120;
	source.soloed = true;
	const main = {
		prepareSource: vi.fn().mockResolvedValue({ pcmPath: "/cache/replacement.wav" }),
		releasePreparedSource: vi.fn().mockResolvedValue(undefined),
	};
	const replacement = await relinkSource(main, source, "/new/replacement.flac");
	expect(main.prepareSource).toHaveBeenCalledWith("/new/replacement.flac", null);
	expect(main.releasePreparedSource).toHaveBeenCalledWith("/cache/replacement.wav");
	expect(replacement).toEqual({ ...source, name: "replacement.flac", audioFilePath: "/new/replacement.flac" });
	expect(source.audioFilePath).toBe("/missing.wav");
});

it("leaves the previous source intact when replacement cannot be prepared", async () => {
	const source = createSourceFromFile("/missing.wav", 0);
	const main = {
		prepareSource: vi.fn().mockRejectedValue(new Error("Unsupported audio")),
		releasePreparedSource: vi.fn().mockResolvedValue(undefined),
	};
	await expect(relinkSource(main, source, "/invalid.wav")).rejects.toThrow("Unsupported");
	expect(source.audioFilePath).toBe("/missing.wav");
	expect(main.releasePreparedSource).not.toHaveBeenCalled();
});
