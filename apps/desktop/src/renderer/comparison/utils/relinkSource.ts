import type { Main } from "../../models/Main";
import type { SourceState } from "../../models/State/App";
import type { Snapshot } from "valtio/vanilla";

export async function relinkSource(
	main: Pick<Main, "prepareSource" | "releasePreparedSource">,
	source: Snapshot<SourceState>,
	filePath: string,
	sampleRate: number | null,
): Promise<SourceState> {
	const prepared = await main.prepareSource(filePath, sampleRate);

	try {
		return {
			...source,
			layerColor: { ...source.layerColor },
			audioFilePath: filePath,
			name: filePath.split(/[/\\]/).pop() ?? source.name,
		};
	} finally {
		await main.releasePreparedSource(prepared.pcmPath);
	}
}
