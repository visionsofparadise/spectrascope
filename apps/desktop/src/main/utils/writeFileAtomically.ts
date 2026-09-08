import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

async function renameAtomically(temporaryPath: string, filePath: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(temporaryPath, filePath);

			return;
		} catch (error) {
			const transient =
				error instanceof Error &&
				"code" in error &&
				typeof error.code === "string" &&
				["EPERM", "EACCES", "EBUSY"].includes(error.code);

			if (process.platform !== "win32" || !transient || attempt >= 5) throw error;

			await new Promise((resolve) => setTimeout(resolve, Math.min(200, 25 * 2 ** attempt)));
		}
	}
}

export async function withAtomicFile(filePath: string, write: (handle: fs.FileHandle) => Promise<void>): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });

	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	let handle: fs.FileHandle | undefined;
	let created = false;

	try {
		handle = await fs.open(temporaryPath, "wx");
		created = true;
		await write(handle);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await renameAtomically(temporaryPath, filePath);
	} finally {
		await handle?.close().catch(() => undefined);

		if (created) await fs.unlink(temporaryPath).catch(() => undefined);
	}
}

export async function writeFileAtomically(filePath: string, content: string | Uint8Array): Promise<void> {
	await withAtomicFile(filePath, async (handle) => {
		await handle.writeFile(content);
	});
}
