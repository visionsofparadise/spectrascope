import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { withAtomicFile, writeFileAtomically } from "./writeFileAtomically";

it.runIf(process.platform === "win32")(
	"retries a transient Windows replacement lock without removing the destination",
	async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-rename-retry-"));
		const destination = path.join(directory, "session.spectra");
		await fs.writeFile(destination, "before");
		const rename = vi
			.spyOn(fs, "rename")
			.mockRejectedValueOnce(Object.assign(new Error("Scanner lock"), { code: "EPERM" }))
			.mockRejectedValueOnce(Object.assign(new Error("Scanner lock"), { code: "EACCES" }));
		try {
			await writeFileAtomically(destination, "after");
			expect(rename).toHaveBeenCalledTimes(3);
			expect(await fs.readFile(destination, "utf8")).toBe("after");
			expect(await fs.readdir(directory)).toEqual(["session.spectra"]);
		} finally {
			rename.mockRestore();
			await fs.rm(directory, { recursive: true, force: true });
		}
	},
);

it.runIf(process.platform === "win32")(
	"bounds Windows replacement retries and preserves the old destination on exhaustion",
	async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-rename-exhausted-"));
		const destination = path.join(directory, "session.spectra");
		await fs.writeFile(destination, "before");
		const rename = vi
			.spyOn(fs, "rename")
			.mockRejectedValue(Object.assign(new Error("Persistent lock"), { code: "EBUSY" }));
		try {
			await expect(writeFileAtomically(destination, "after")).rejects.toThrow("Persistent lock");
			expect(rename).toHaveBeenCalledTimes(6);
			expect(await fs.readFile(destination, "utf8")).toBe("before");
			expect(await fs.readdir(directory)).toEqual(["session.spectra"]);
		} finally {
			rename.mockRestore();
			await fs.rm(directory, { recursive: true, force: true });
		}
	},
);

it("leaves an existing temporary path untouched when exclusive creation fails", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-exclusive-"));
	const open = vi
		.spyOn(fs, "open")
		.mockRejectedValueOnce(Object.assign(new Error("Already exists"), { code: "EEXIST" }));
	const unlink = vi.spyOn(fs, "unlink");
	const write = vi.fn();
	try {
		await expect(withAtomicFile(path.join(directory, "session.spectra"), write)).rejects.toThrow("Already exists");
		expect(write).not.toHaveBeenCalled();
		expect(unlink).not.toHaveBeenCalled();
	} finally {
		open.mockRestore();
		unlink.mockRestore();
		await fs.rm(directory, { recursive: true, force: true });
	}
});

it("keeps the previous destination when a bounded writer fails and cleans its temporary sibling", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-atomic-"));
	try {
		const destination = path.join(directory, "session.spectra");
		await writeFileAtomically(destination, "before");
		await expect(
			withAtomicFile(destination, async (handle) => {
				await handle.writeFile("partial");
				throw new Error("disk failure");
			}),
		).rejects.toThrow("disk failure");
		expect(await fs.readFile(destination, "utf8")).toBe("before");
		expect(await fs.readdir(directory)).toEqual(["session.spectra"]);
		await Promise.all([writeFileAtomically(destination, "first"), writeFileAtomically(destination, "second")]);
		expect(["first", "second"]).toContain(await fs.readFile(destination, "utf8"));
		expect(await fs.readdir(directory)).toEqual(["session.spectra"]);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});
