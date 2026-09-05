import { main } from "../models/Main";
import { AUDIO_FILE_EXTENSIONS } from "./createComparison";

export async function pickAudioFiles(): Promise<ReadonlyArray<string> | null> {
	const filePaths = await main.showOpenDialog({
		filters: [{ name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
		properties: ["openFile", "multiSelections"],
	});

	return filePaths && filePaths.length > 0 ? filePaths : null;
}
