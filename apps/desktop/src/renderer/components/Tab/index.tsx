import type { AppContext } from "../../models/Context";
import { HomeScreen } from "../HomeScreen";

interface Props {
	readonly context: AppContext;
}

export function TabContent({ context }: Props) {
	const activeTab = context.app.activeTabId ? context.app.tabs.find((tab) => tab.id === context.app.activeTabId) : null;

	if (!activeTab) {
		return <HomeScreen context={context} />;
	}

	return <div className="flex flex-1 flex-col bg-void" />;
}
