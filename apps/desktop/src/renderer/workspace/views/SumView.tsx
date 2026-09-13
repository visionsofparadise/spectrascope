import { DerivedPairView } from "./DerivedPairView";
import type { DerivedSpectralViewProps, DifferenceSelectionProps } from "./viewProps";

export function SumView(props: DerivedSpectralViewProps & DifferenceSelectionProps) {
	return <DerivedPairView {...props} viewId="sum" operator="+" />;
}
