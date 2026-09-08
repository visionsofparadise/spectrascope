import { markSessionSaved, parseSession, serializeSession } from "./sessionDocument";
import type { Main } from "../../models/Main";
import type { Comparison } from "../../models/State/App";
import type { Snapshot } from "valtio/vanilla";

type SessionIO = Pick<Main, "readFile" | "writeFile" | "mapFilePaths">;

export async function openSessionFile(main: SessionIO, filePath: string): Promise<Comparison> {
	const comparison = parseSession(await main.readFile(filePath));
	const paths = await main.mapFilePaths({
		baseFilePath: filePath,
		paths: comparison.sources.map((source) => source.audioFilePath),
		mode: "absolute",
	});

	comparison.sources = comparison.sources.map((source, index) => ({
		...source,
		audioFilePath: paths[index] ?? source.audioFilePath,
	}));

	return markSessionSaved(comparison, filePath);
}

export async function saveSessionFile(
	main: SessionIO,
	comparison: Snapshot<Comparison>,
	filePath: string,
): Promise<void> {
	const paths = await main.mapFilePaths({
		baseFilePath: filePath,
		paths: comparison.sources.map((source) => source.audioFilePath),
		mode: "relative",
	});

	await main.writeFile(filePath, serializeSession(comparison, paths));
}
