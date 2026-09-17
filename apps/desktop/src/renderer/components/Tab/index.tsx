import { scope } from "opshot/react";
import { HomeScreen } from "../HomeScreen";
import { SessionTab } from "./Session";
import type { ExportControl } from "../../export/ExportControl";
import type { AppContext } from "../../models/Context";

interface Props {
	readonly onExportControlChange: (control: ExportControl | null) => void;
	readonly context: AppContext;
}

export const TabContent = scope<Props>(({ onExportControlChange, context }: Props) => {
	const { app } = context;
	const activeTab = app.activeTabId ? app.tabs.find((tab) => tab.id === app.activeTabId) : null;

	if (!activeTab) {
		return <HomeScreen context={context} />;
	}

	const session = app.sessions.find((entry) => entry.id === activeTab.sessionId);

	if (!session) {
		return <HomeScreen context={context} />;
	}

	return (
		<SessionTab key={session.id} session={session} context={context} onExportControlChange={onExportControlChange} />
	);
});
