import { batch } from "opshot";
import { normalizeSelection } from "../../workspace/utils/selection";
import { createSourceFromFile } from "../createSavedSession";
import type { SessionContext } from "../../models/Context";
import type { DocumentMeta } from "../../models/History";

export function appendSources(filePaths: ReadonlyArray<string>, context: SessionContext): void {
	const { document } = context.session;
	const base = document.sources.length;

	for (const [offset, filePath] of filePaths.entries()) {
		document.sources.push(createSourceFromFile(filePath, base + offset));
	}
}

export function removeSource(sourceId: string, context: SessionContext): void {
	const { document } = context.session;
	const index = document.sources.findIndex((source) => source.id === sourceId);

	if (index < 0) return;

	document.sources.splice(index, 1);

	if (document.differenceA === sourceId) document.differenceA = null;

	if (document.differenceB === sourceId) document.differenceB = null;
}

export function selectRange(
	next: { start: number; end: number } | null,
	durationMs: number,
	context: SessionContext,
): void {
	const { document, transport } = context.session;
	const selection = next ? normalizeSelection(next.start, next.end, durationMs) : null;

	document.selection = selection;

	if (selection) transport.looping = true;
}

export function setDifference(
	differenceA: string | null,
	differenceB: string | null,
	meta: DocumentMeta,
	context: SessionContext,
): void {
	const { document } = context.session;
	const write = () => {
		document.differenceA = differenceA;
		document.differenceB = differenceB;
	};

	if (meta === undefined) write();
	else batch(write, meta);
}
