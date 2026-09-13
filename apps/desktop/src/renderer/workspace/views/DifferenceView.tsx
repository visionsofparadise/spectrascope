import { NEUTRAL_LAYER_COLOR } from "../layers";
import { DerivedPairView } from "./DerivedPairView";
import type { Source } from "../source";
import type { DerivedSpectralViewProps, DifferenceSelectionProps } from "./viewProps";

const layerColorOfA = (pairA: Source | undefined) => pairA?.layerColor ?? NEUTRAL_LAYER_COLOR;

export function DifferenceView({ theme: _theme, ...props }: DerivedSpectralViewProps & DifferenceSelectionProps) {
	return <DerivedPairView {...props} viewId="difference" operator="−" layerColorOf={layerColorOfA} />;
}
