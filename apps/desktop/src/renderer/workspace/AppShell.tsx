import type { ReactNode } from "react";

interface AppShellProps {
	readonly workspace: ReactNode;
	readonly transport: ReactNode;
}

export function AppShell({ workspace, transport }: AppShellProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col bg-void text-chrome-text">
			<main className="min-h-0 flex-1 overflow-hidden">{workspace}</main>
			<div className="h-[92px] shrink-0">{transport}</div>
		</div>
	);
}
