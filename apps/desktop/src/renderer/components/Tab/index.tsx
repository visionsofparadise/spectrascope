import type { AppContext } from "../../models/Context";
import { HomeScreen } from "../HomeScreen";
import { ComparisonTab } from "./Comparison";

interface Props {
	readonly context: AppContext;
}

/**
 * The tab-content slot. With no active tab it renders the home screen; with an
 * active tab it resolves that tab's comparison from the store and mounts the
 * workspace shell (`ComparisonTab`). A tab whose `comparisonId` resolves to no
 * comparison falls back to the home screen — `loadAppState` already drops such
 * tabs, so this is a defensive guard.
 */
export function TabContent({ context }: Props) {
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
		/>
	);
}
