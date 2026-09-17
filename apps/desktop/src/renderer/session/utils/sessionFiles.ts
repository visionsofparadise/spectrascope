import { markSessionSaved, parseSession, serializeSession } from "./sessionDocument";
import type { Main } from "../../models/Main";
import type { SavedSession } from "../../models/State/App";

type SessionIO = Pick<Main, "readFile" | "writeFile" | "mapFilePaths">;

export async function openSessionFile(main: SessionIO, filePath: string): Promise<SavedSession> {
	const session = parseSession(await main.readFile(filePath));
	const paths = await main.mapFilePaths({
		baseFilePath: filePath,
		paths: session.sources.map((source) => source.audioFilePath),
		mode: "absolute",
	});

	session.sources = session.sources.map((source, index) => ({
		...source,
		audioFilePath: paths[index] ?? source.audioFilePath,
	}));

	return markSessionSaved(session, filePath);
}

export async function saveSessionFile(main: SessionIO, session: SavedSession, filePath: string): Promise<void> {
	const paths = await main.mapFilePaths({
		baseFilePath: filePath,
		paths: session.sources.map((source) => source.audioFilePath),
		mode: "relative",
	});

	await main.writeFile(filePath, serializeSession(session, paths));
}
