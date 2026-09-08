export interface ExportControl {
	readonly name: string;
	readonly streamKey: string | null;
	readonly streamLabel: string;
	readonly selection: { readonly start: number; readonly end: number } | null;
	readonly protectedPaths: ReadonlyArray<string>;
}

export type ExportKind = "png" | "wav" | "csv";
export type ExportRange = "full" | "selection";
