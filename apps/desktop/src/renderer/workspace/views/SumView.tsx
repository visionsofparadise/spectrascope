import { scope } from "opshot/react";
import { DerivedPairView } from "./DerivedPairView";
import type { DerivedSpectralViewProps } from "./viewProps";

export const SumView = scope<DerivedSpectralViewProps>((props: DerivedSpectralViewProps) => (
	<DerivedPairView {...props} viewId="sum" operator="+" />
));
