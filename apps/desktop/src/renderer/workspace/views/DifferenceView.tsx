import { DerivedPairView } from "./DerivedPairView";
import type { DerivedSpectralViewProps, DifferenceSelectionProps } from "./viewProps";

export function DifferenceView(props: DerivedSpectralViewProps & DifferenceSelectionProps) {
	return <DerivedPairView {...props} viewId="difference" operator="−" />;
}
