import { scope } from "opshot/react";
import { DerivedPairView } from "./DerivedPairView";
import type { DerivedSpectralViewProps } from "./viewProps";

export const DifferenceView = scope<DerivedSpectralViewProps>((props: DerivedSpectralViewProps) => (
	<DerivedPairView {...props} viewId="difference" operator="−" />
));
