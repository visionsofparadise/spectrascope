/** The two derived signals the render service can produce. */
export type RenderOperation = "sum" | "difference";

/** A single audio source feeding a derived render. */
export interface RenderInput {
	/** Absolute path to the source audio file. ffmpeg reads it directly. */
	readonly filePath: string;
	/** Where this source sits on the comparison timeline, in milliseconds (>= 0). */
	readonly offsetMs: number;
}

/**
 * A fully-resolved description of a derived render.
 *
 * `inputs` is the ordered audible source set (solo-resolved by the caller).
 * For a `"difference"` render, `referenceIndex` is the index into `inputs` of
 * the reference source (the first audible source); every other input is
 * polarity-inverted before mixing. It is ignored for a `"sum"` render.
 */
export interface RenderSpec {
	readonly operation: RenderOperation;
	readonly inputs: ReadonlyArray<RenderInput>;
	readonly referenceIndex: number;
}
