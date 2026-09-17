export function normalizeSelection(
	start: number,
	end: number,
	durationMs: number,
): { start: number; end: number } | null {
	if (![start, end, durationMs].every(Number.isFinite) || durationMs <= 0) return null;

	const lower = Math.max(0, Math.min(durationMs, Math.min(start, end)));
	const upper = Math.max(0, Math.min(durationMs, Math.max(start, end)));

	return upper > lower ? { start: lower, end: upper } : null;
}

export function normalizedSelectionOf(
	selection: { readonly start: number; readonly end: number } | null,
	durationMs: number,
): { start: number; end: number } | null {
	return selection ? normalizeSelection(selection.start, selection.end, durationMs) : null;
}

export interface SelectionGesture {
	readonly anchor: number;
	readonly active: number;
	readonly selection: { start: number; end: number } | null;
}

export function extendSelection(
	previous: SelectionGesture | null,
	selection: { start: number; end: number } | null,
	positionMs: number,
	deltaMs: number,
	durationMs: number,
): SelectionGesture {
	const continuing =
		previous && previous.selection?.start === selection?.start && previous.selection?.end === selection?.end;
	const anchor = continuing ? previous.anchor : Math.max(0, Math.min(durationMs, selection?.start ?? positionMs));
	const from = continuing ? previous.active : (selection?.end ?? anchor);
	const active = Math.max(0, Math.min(durationMs, from + deltaMs));

	return { anchor, active, selection: normalizeSelection(anchor, active, durationMs) };
}

export function isNestedSelectionControl(target: EventTarget | null, surface: HTMLElement): boolean {
	if (!(target instanceof Element)) return false;

	const control = target.closest(
		'button,input,select,textarea,a[href],[contenteditable]:not([contenteditable="false"]),[role="slider"],[role="button"],[role="textbox"],[tabindex]',
	);

	return control !== null && control !== surface;
}
