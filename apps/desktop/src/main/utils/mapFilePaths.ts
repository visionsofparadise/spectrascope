import path from "node:path";

export interface MapFilePathsOptions {
	readonly baseFilePath: string;
	readonly paths: ReadonlyArray<string>;
	readonly mode: "relative" | "absolute";
}

export function mapFilePaths(options: MapFilePathsOptions): Array<string> {
	const api = /^[a-z]:[/\\]|^[/\\]{2}/i.test(options.baseFilePath) ? path.win32 : path.posix;
	const base = api.dirname(options.baseFilePath);

	return options.paths.map((filePath) => {
		if (filePath === "") return "";

		if (options.mode === "absolute") return api.resolve(base, filePath);

		const relative = api.relative(base, filePath);

		return (api.isAbsolute(relative) ? filePath : relative).replace(/\\/g, "/");
	});
}
