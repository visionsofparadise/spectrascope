import { DEFAULT_LAYER_PALETTE } from "./layers";
import type { LayerColor } from "./layers";

export interface Source {
	readonly id: string;
	readonly name: string;
	readonly audioFilePath: string;
	readonly timelineOffsetMs: number;
	readonly layerColor: LayerColor;
	readonly visible: boolean;
	readonly muted: boolean;
	readonly soloed: boolean;
}

function generateId(): string {
	const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;

	if (cryptoRef?.randomUUID) {
		return cryptoRef.randomUUID();
	}

	return `src-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

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
