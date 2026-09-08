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
				gridTemplateColumns: "240px minmax(0, 1fr)",
				gridTemplateRows: hasTransport ? "minmax(0, 1fr) 92px" : "minmax(0, 1fr)",
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

			{hasTransport && (
				<div className="min-w-0" style={{ gridColumn: "2", gridRow: "2" }}>
					{transport}
				</div>
			)}
		</div>
	);
}
