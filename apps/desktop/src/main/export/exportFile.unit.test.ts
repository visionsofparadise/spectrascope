import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertExportDestination, exportFileName } from "./exportFile";

describe("export destinations", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-destination-"));
	});
	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});
	it("refuses source aliases and hard links", async () => {
		const source = path.join(directory, "source.wav");
		const alias = path.join(directory, "alias.wav");
		await fs.writeFile(source, "audio");
		await fs.link(source, alias);
		await expect(assertExportDestination(alias, [source])).rejects.toThrow("different export destination");
		await expect(
			assertExportDestination(path.join(directory, "nested", "..", "source.wav"), [source]),
		).rejects.toThrow("different export destination");
		expect(await fs.readFile(source, "utf8")).toBe("audio");
	});
	it("allows a new independent destination", async () => {
		await expect(
			assertExportDestination(path.join(directory, "output.wav"), [path.join(directory, "source.wav")]),
		).resolves.toBeUndefined();
	});
	it("creates a safe format-specific suggested filename", () => {
		expect(exportFileName("Session.spectra", "csv")).toBe("Session.csv");
		expect(exportFileName("", "png")).toBe("Spectrascope.png");
		expect(exportFileName("Mix: alternate?", "wav")).toBe("Mix- alternate-.wav");
	});
});
