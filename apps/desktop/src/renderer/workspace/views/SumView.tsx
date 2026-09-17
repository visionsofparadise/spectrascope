import { DerivedPairView } from "./DerivedPairView";
import type { DerivedSpectralViewProps } from "./viewProps";

export function SumView(props: DerivedSpectralViewProps) {
	return <DerivedPairView {...props} viewId="sum" operator="+" />;
}
