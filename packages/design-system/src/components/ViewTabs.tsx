/**
 * ViewTabs — the strip across the top of the workspace pane.
 *
 * Left: the seven first-pass view tabs. Tabs follow the design system's
 * button grammar — the outer `<button>` is a transparent, padded click
 * target; an inner `<span>` hugs the label and carries the active-state
 * `bg-secondary` chip (viridis purple). Switching tabs re-renders the
 * workspace pane entirely; no underline indicator, no animation. Labels never
 * wrap (`whitespace-nowrap`); if the workspace is too narrow for all seven,
 * the tab group scrolls horizontally rather than wrapping a label.
 *
 * Right: an actions cluster — global on every view. A cross-view Sync toggle,
 * a Mono / Stereo channel-mode selector, then undo / redo past a divider. All
 * are first-pass visual stubs (no sync wiring, no channel fold, no undo stack
 * yet), matching the transport's stubbed loop / speed controls.
 *
 * See [design-visual-language.md → View Tabs] and
 * [design-components.md → ViewTabs].
 */

import { Icon } from "@iconify/react";
import { useState } from "react";
import { IconButton } from "./IconButton";

export type ViewId =
  | "timeline"
  | "overlay"
  | "slider"
  | "difference"
  | "sum"
  | "frequency-distribution"
  | "loudness";

interface ViewTabsProps {
  readonly active: ViewId;
  readonly onActiveChange: (id: ViewId) => void;
}

interface TabDef {
  readonly id: ViewId;
  readonly label: string;
}

const TABS: ReadonlyArray<TabDef> = [
  { id: "timeline", label: "Timeline" },
  { id: "overlay", label: "Overlay" },
  { id: "slider", label: "Slider" },
  { id: "difference", label: "Difference" },
  { id: "sum", label: "Sum" },
  { id: "frequency-distribution", label: "Freq Dist" },
  { id: "loudness", label: "Loudness" },
];

/**
 * SyncToggle — a global tab-strip control. A labelled toggle (link glyph +
 * "Sync") for cross-view sync — shared cursor / selection / time-range, see
 * [design-visual-language.md → Sync]. Follows the tab button grammar: the
 * outer button owns the padding, the inner span owns the active-state
 * `bg-secondary` chip and hugs its content. First-pass visual stub — it holds
 * its own on/off state; the cross-view wiring is future work, like the
 * transport's loop / speed stubs.
 */
function SyncToggle() {
  const [enabled, setEnabled] = useState(false);

  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={enabled ? "Disable cross-view sync" : "Enable cross-view sync"}
      onClick={() => {
        setEnabled((prev) => !prev);
      }}
      className="flex shrink-0 items-center px-2 py-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text"
    >
      <span
        className={`flex items-center gap-1 ${
          enabled ? "bg-secondary text-chrome-text" : ""
        }`}
      >
        <Icon icon="lucide:link" width={14} height={14} aria-hidden="true" />
        <span>Sync</span>
      </span>
    </button>
  );
}

/** The two channel-fold modes the ChannelModeToggle selects between. */
const CHANNEL_MODES = ["Mono", "Stereo"] as const;

type ChannelMode = (typeof CHANNEL_MODES)[number];

/**
 * ChannelModeToggle — a global segmented selector for how sources are folded
 * for display and audition: Mono (channel-summed) or Stereo. Each segment
 * follows the tab button grammar — a padded transparent `<button>` wrapping an
 * inner `<span>` that carries the active-state `bg-secondary` chip. First-pass
 * visual stub: it holds its own state; the channel-fold wiring is future work.
 */
function ChannelModeToggle() {
  const [mode, setMode] = useState<ChannelMode>("Stereo");

  return (
    <div
      role="group"
      aria-label="Channel mode"
      className="flex shrink-0 items-center"
    >
      {CHANNEL_MODES.map((option) => {
        const isActive = option === mode;

        return (
          <button
            key={option}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              setMode(option);
            }}
            className="flex shrink-0 items-center px-2 py-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text"
          >
            {/* Button grammar: the outer button owns the padding; this inner
                span owns the active-state chip and hugs the label. */}
            <span
              className={`flex items-center ${
                isActive ? "bg-secondary text-chrome-text" : ""
              }`}
            >
              {option}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * ViewActions — the right-hand cluster of the strip, global on every view: a
 * cross-view Sync toggle, a Mono / Stereo channel-mode selector, then undo /
 * redo past a divider. All are first-pass visual stubs.
 */
function ViewActions() {
  return (
    <div className="flex shrink-0 items-center gap-2 pr-3">
      <SyncToggle />
      <ChannelModeToggle />
      {/* Divider — separates the mode toggles from the history actions. */}
      <div className="h-4 w-px shrink-0 bg-chrome-border-subtle" />
      {/* Undo / redo — visual stubs for now (no undo stack yet), matching the
          transport's stubbed media controls. Ghost variant so they recede
          until hovered. */}
      <IconButton icon="lucide:undo-2" label="Undo" size={16} variant="ghost" />
      <IconButton
        icon="lucide:redo-2"
        label="Redo"
        size={16}
        variant="ghost"
        dim
      />
    </div>
  );
}

export function ViewTabs({ active, onActiveChange }: ViewTabsProps) {
  return (
    <div className="flex h-10 shrink-0 items-stretch bg-void">
      {/* Tab group — scrolls horizontally when the strip is too narrow for
          all seven labels. */}
      <div
        role="tablist"
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === active;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                onActiveChange(tab.id);
              }}
              className="flex shrink-0 items-center px-3 py-2.5 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text"
            >
              {/* Button grammar (design-components.md → "No-padding
                  aesthetic"): the outer button owns the padding / click
                  target; this inner span owns the background and hugs the
                  label with no padding of its own. */}
              <span
                className={`flex items-center whitespace-nowrap ${
                  isActive ? "bg-secondary text-chrome-text" : ""
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Right-side actions — global on every view. */}
      <ViewActions />
    </div>
  );
}
