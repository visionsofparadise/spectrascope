import fs from "node:fs/promises";
import path from "node:path";

async function canonicalPath(filePath: string): Promise<string> {
	const resolved = path.resolve(filePath);

	try {
		return await fs.realpath(resolved);
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;

		const parent = path.dirname(resolved);

		return parent === resolved ? resolved : path.join(await canonicalPath(parent), path.basename(resolved));
	}
}

export async function assertExportDestination(filePath: string, protectedPaths: ReadonlyArray<string>): Promise<void> {
	const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
	const destination = normalize(await canonicalPath(filePath));
	const destinationStats = await fs.stat(filePath).catch(() => null);

	for (const protectedPath of protectedPaths) {
		if (!protectedPath) continue;

		const protectedCanonical = normalize(await canonicalPath(protectedPath));
		const protectedStats = destinationStats ? await fs.stat(protectedPath).catch(() => null) : null;
		const sameFile =
			destinationStats?.dev === protectedStats?.dev &&
			destinationStats?.ino === protectedStats?.ino &&
			destinationStats !== null;

		if (destination === protectedCanonical || sameFile)
			throw new Error("Choose a different export destination. This path belongs to session or source audio.");
	}
}

export function exportFileName(name: string, extension: "wav" | "csv" | "png"): string {
	const safe = Array.from(path.basename(name), (character) => (character.charCodeAt(0) < 32 ? "-" : character))
		.join("")
		.replace(/[<>:"/\\|?*]/g, "-")
		.replace(/\.(spectra|wav|csv|png)$/i, "")
		.trim();

	return `${safe || "Spectrascope"}.${extension}`;
}
