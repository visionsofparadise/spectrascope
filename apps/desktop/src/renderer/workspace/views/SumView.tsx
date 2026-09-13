import { useCallback } from "react";
import { THEME_PALETTES } from "../../utils/themePalettes";
import { DerivedPairView } from "./DerivedPairView";
import type { DerivedSpectralViewProps, DifferenceSelectionProps } from "./viewProps";

export function SumView({ theme, ...props }: DerivedSpectralViewProps & DifferenceSelectionProps) {
	const layerColorOf = useCallback(
		() => ({ primary: THEME_PALETTES[theme].accent, secondary: THEME_PALETTES[theme].tint }),
		[theme],
	);

	return <DerivedPairView {...props} viewId="sum" operator="+" layerColorOf={layerColorOf} />;
}
