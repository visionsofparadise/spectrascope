import type { ReactNode } from "react";

interface AppShellProps {
	readonly sidebar: ReactNode;
	readonly workspace: ReactNode;
	/**
	 * Bottom transport strip. Optional — when absent (e.g. the Frequency
	 * Distribution view, which has no playback) the workspace pane spans the
	 * full height and no transport row is rendered.
	 */
	readonly transport?: ReactNode;
}

export function AppShell({ sidebar, workspace, transport }: AppShellProps) {
	const hasTransport = transport !== undefined && transport !== null;

	return (
		<div
			className="grid h-full w-full bg-void text-chrome-text"
			style={{
				gridTemplateColumns: "240px 1fr",
				gridTemplateRows: hasTransport ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)",
			}}
		>
			<aside
				className="min-h-0 overflow-visible bg-void"
				style={{ gridColumn: "1", gridRow: hasTransport ? "1 / span 2" : "1" }}
			>
				{sidebar}
			</aside>

			<main className="min-h-0 min-w-0 overflow-hidden bg-void" style={{ gridColumn: "2", gridRow: "1" }}>
				{workspace}
			</main>

			{hasTransport && <div style={{ gridColumn: "2", gridRow: "2", height: "92px" }}>{transport}</div>}
		</div>
	);
}
