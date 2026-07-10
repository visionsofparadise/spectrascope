import { DEFAULT_LAYER_PALETTE } from "./layers";
import type { LayerColor } from "./layers";

/**
 * One row in the sources panel. Source = layer 1:1.
 *
 * Carries no PCM. Audio buffers are the consumer's concern (view containers
 * provide their own buffers; the panel only mutates flags here).
 *
 * See [design-components.md → Source](../../../../../../D:/Documents/Planner/projects/code/spectrascope/design-system/design-components.md)
 * and [design-visual-language.md → Sources Panel](../../../../../../D:/Documents/Planner/projects/code/spectrascope/design-system/design-visual-language.md).
 */
export interface Source {
	readonly id: string;
	readonly name: string;
	/** Absolute path of the real audio file this source represents. */
	readonly audioFilePath: string;
	/** Position of the source on the comparison's shared timeline, in milliseconds (≥ 0). Default 0. */
	readonly timelineOffsetMs: number;
	readonly layerColor: LayerColor;
	readonly visible: boolean;
	readonly muted: boolean;
	readonly soloed: boolean;
}

/**
 * Generate a stable id. Prefers `crypto.randomUUID` when available (browsers,
 * Node 19+); falls back to a Math.random based string when running in
 * environments without the WebCrypto API (older test runners, edge cases).
 */
function generateId(): string {
	const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;

	if (cryptoRef?.randomUUID) {
		return cryptoRef.randomUUID();
	}

	return `src-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/**
 * Build a `Source` with default values for the given index. The layer color is
 * picked round-robin from `DEFAULT_LAYER_PALETTE` (length 4). All other fields
 * are overridable via `partial`.
 */
/**
 * Hard fallback when the palette is empty — not expected in practice, but
 * keeps `createDefaultSource` total without leaning on a non-null assertion.
 */
const FALLBACK_LAYER_COLOR: LayerColor = { primary: "#F59E0B", secondary: "#7C2D12" };

export function createDefaultSource(index: number, partial?: Partial<Source>): Source {
	const paletteEntry = DEFAULT_LAYER_PALETTE[index % DEFAULT_LAYER_PALETTE.length];
	const layerColor: LayerColor = paletteEntry ?? FALLBACK_LAYER_COLOR;

	return {
		id: generateId(),
		name: `Source ${index + 1}`,
		audioFilePath: "",
		timelineOffsetMs: 0,
		layerColor,
		visible: true,
		muted: false,
		soloed: false,
		...partial,
	};
}
