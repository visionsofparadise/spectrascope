import { HomeScreen } from "../HomeScreen";
import { ComparisonTab } from "./Comparison";
import type { AppContext } from "../../models/Context";
import type { HistoryControl } from "../../state/useComparisonHistory";

interface Props {
	readonly context: AppContext;
	/**
	 * Publish the active comparison's undo/redo control up to the layout (which
	 * feeds the app bar). `ComparisonTab` calls it with its control on change and
	 * `null` on unmount; Home renders no `ComparisonTab`, so the layout also
	 * clears the control when no tab is active.
	 */
	readonly onHistoryControlChange: (control: HistoryControl | null) => void;
}

/**
 * The tab-content slot. With no active tab it renders the home screen; with an
 * active tab it resolves that tab's comparison from the store and mounts the
 * workspace shell (`ComparisonTab`). A tab whose `comparisonId` resolves to no
 * comparison falls back to the home screen — `loadAppState` already drops such
 * tabs, so this is a defensive guard.
 */
export function TabContent({ context, onHistoryControlChange }: Props) {
	const activeTab = context.app.activeTabId
		? context.app.tabs.find((tab) => tab.id === context.app.activeTabId)
		: null;

	if (!activeTab) {
		return <HomeScreen context={context} />;
	}

	const comparison = context.app.comparisons.find((entry) => entry.id === activeTab.comparisonId);

	if (!comparison) {
		return <HomeScreen context={context} />;
	}

	return (
		<ComparisonTab
			key={comparison.id}
			context={context}
			comparison={comparison}
			onHistoryControlChange={onHistoryControlChange}
		/>
	);
}
