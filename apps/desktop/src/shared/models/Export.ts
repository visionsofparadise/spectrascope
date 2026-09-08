export interface ExportStreamOptions {
	readonly key: string;
	readonly kind: "wav" | "csv";
	readonly startMs?: number;
	readonly endMs?: number;
	readonly suggestedName: string;
	readonly protectedPaths: ReadonlyArray<string>;
}

export interface ExportImageOptions {
	readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	readonly suggestedName: string;
	readonly protectedPaths: ReadonlyArray<string>;
}
