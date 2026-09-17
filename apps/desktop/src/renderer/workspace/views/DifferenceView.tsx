import { DerivedPairView } from "./DerivedPairView";
import type { DerivedSpectralViewProps } from "./viewProps";

export function DifferenceView(props: DerivedSpectralViewProps) {
	return <DerivedPairView {...props} viewId="difference" operator="−" />;
}
