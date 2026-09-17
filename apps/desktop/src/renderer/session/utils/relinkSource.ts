import type { Main } from "../../models/Main";
import type { SourceState } from "../../models/State/App";

export async function relinkSource(
	main: Pick<Main, "prepareSource" | "releasePreparedSource">,
	source: SourceState,
	filePath: string,
): Promise<SourceState> {
	const prepared = await main.prepareSource(filePath, null);

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
