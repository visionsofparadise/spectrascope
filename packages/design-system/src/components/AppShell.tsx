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

/**
 * AppShell — the three-zone workspace layout primitive.
 *
 * CSS grid:
 *   columns: [sidebar 240px | workspace 1fr]
 *   rows:    [main 1fr | transport auto (~76px)]   (transport row omitted
 *            entirely when no transport is supplied)
 *
 * The sidebar spans both rows on the left; the workspace and transport split
 * the right column vertically. Owns no state. Pure layout primitive.
 *
 * Every zone shares the `bg-void` surface — there is no chrome divider between
 * the sidebar and the workspace, or between the workspace and the transport.
 * The whole shell reads as one continuous dark surface; sections are
 * distinguished by their content, not by borders.
 */
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
      {/* Sidebar — col 1. Spans both rows when a transport is present. */}
      <aside
        className="min-h-0 overflow-hidden bg-void"
        style={{ gridColumn: "1", gridRow: hasTransport ? "1 / span 2" : "1" }}
      >
        {sidebar}
      </aside>

      {/* Workspace — row 1, col 2 */}
      <main
        className="min-h-0 min-w-0 overflow-hidden bg-void"
        style={{ gridColumn: "2", gridRow: "1" }}
      >
        {workspace}
      </main>

      {/* Transport — row 2, col 2. The Transport component owns its own
          `bg-void` background; the shell row contributes no chrome of its
          own. */}
      {hasTransport && (
        <div style={{ gridColumn: "2", gridRow: "2", height: "76px" }}>
          {transport}
        </div>
      )}
    </div>
  );
}
