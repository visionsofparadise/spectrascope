/**
 * ViewTabs — the strip across the top of the workspace pane.
 *
 * Left: the nine view tabs (the seven first-pass tabs plus the Correlation
 * and Vectorscope stereo-analysis tabs). Tabs follow the design system's
 * button grammar — the outer `<button>` is a transparent, padded click
 * target; an inner `<span>` hugs the label and carries the active-state
 * `bg-secondary` chip (viridis purple). Switching tabs re-renders the
 * workspace pane entirely; no underline indicator, no animation. Labels never
 * wrap (`whitespace-nowrap`); if the workspace is too narrow for all tabs,
 * the tab group scrolls horizontally rather than wrapping a label.
 *
 * Right: an actions cluster — global on every view. A cross-view Sync toggle,
 * a Mono / Mid / Side channel-input selector, then undo / redo past a divider.
 * All three are controlled — the host owns their state and the design system
 * only renders the visual elements. The channel-input selector drives the
 * `channelInput` compute parameter for every per-source spectrogram view; the
 * Sync toggle drives cross-view cursor / selection / time-range
 * synchronization; undo / redo drive the host's comparison-edit history (the
 * desktop app — the demo passes no-op handlers and keeps them disabled).
 *
 * See [design-visual-language.md → View Tabs] and
 * [design-components.md → ViewTabs].
 */

import { Icon } from "@iconify/react";
import type { ChannelInput } from "spectral-display";
import { IconButton } from "./IconButton";

export type ViewId =
  | "timeline"
  | "overlay"
  | "slider"
  | "difference"
  | "sum"
  | "frequency-distribution"
  | "loudness"
  | "correlation"
  | "vectorscope";

interface ViewTabsProps {
  readonly active: ViewId;
  readonly onActiveChange: (id: ViewId) => void;
  /** The global Mono/Mid/Side channel-input mode (owned by `Workspace`). */
  readonly channelInput: ChannelInput;
  readonly onChannelInputChange: (next: ChannelInput) => void;
  /**
   * Whether cross-view sync is on. Controlled — the host owns the on/off
   * state (the desktop comparison; the demo holds it locally), the design
   * system only renders the visual toggle and emits changes.
   */
  readonly syncEnabled: boolean;
  readonly onSyncEnabledChange: (next: boolean) => void;
  /**
   * Undo / redo the host's comparison-edit history. Controlled — the host owns
   * the history stack (the desktop app's `useComparisonHistory`); the design
   * system only renders the two `IconButton`s and emits clicks. `canUndo` /
   * `canRedo` drive the disabled state — each button is dimmed and inert at its
   * end of history. The demo passes no-op handlers with both flags `false`.
   */
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
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
  { id: "correlation", label: "Correlation" },
  { id: "vectorscope", label: "Vectorscope" },
];

/**
 * SyncToggle — a global tab-strip control. A labelled toggle (link glyph +
 * "Sync") for cross-view sync — shared cursor / selection / time-range, see
 * [design-visual-language.md → Sync]. Follows the tab button grammar: the
 * outer button owns the padding, the inner span owns the active-state
 * `bg-secondary` chip and hugs its content. Controlled — `enabled` /
 * `onEnabledChange` are owned by the host (the desktop comparison; the demo
 * holds it locally), so the design system only provides the visual element.
 * The flag drives the `SyncProvider` the host mounts around the workspace.
 */
function SyncToggle({
  enabled,
  onEnabledChange,
}: {
  readonly enabled: boolean;
  readonly onEnabledChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={enabled ? "Disable cross-view sync" : "Enable cross-view sync"}
      onClick={() => {
        onEnabledChange(!enabled);
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

/**
 * The three channel-input modes the `ChannelInputSelector` selects between.
 * Each segment's `value` is a `ChannelInput` (the `spectral-display` compute
 * parameter); `label` is its display text. There is no "Stereo" option — a
 * spectrogram input is always a single channel, so the modes are the three
 * derived signals Mono / Mid / Side.
 */
const CHANNEL_INPUT_OPTIONS: ReadonlyArray<{
  readonly value: ChannelInput;
  readonly label: string;
}> = [
  { value: "mono", label: "Mono" },
  { value: "mid", label: "Mid" },
  { value: "side", label: "Side" },
];

/**
 * ChannelInputSelector — a global segmented selector for which derived signal
 * feeds the per-source spectrogram FFT: Mono (channel sum), Mid (`(L+R)/2`), or
 * Side (`(L-R)/2`). Controlled — `value`/`onChange` are owned by `Workspace`,
 * which threads `channelInput` down through every per-source view into
 * `SourceStrip`'s `useSpectralCompute` config (it is a compute parameter, so a
 * change re-runs the spectrogram pipeline). Each segment follows the tab button
 * grammar — a padded transparent `<button>` wrapping an inner `<span>` that
 * carries the active-state `bg-secondary` chip.
 */
function ChannelInputSelector({
  value,
  onChange,
}: {
  readonly value: ChannelInput;
  readonly onChange: (next: ChannelInput) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Channel input"
      className="flex shrink-0 items-center"
    >
      {CHANNEL_INPUT_OPTIONS.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              onChange(option.value);
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
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * ViewActions — the right-hand cluster of the strip, global on every view: a
 * cross-view Sync toggle (controlled), a Mono / Mid / Side channel-input
 * selector (controlled), then undo / redo past a divider (controlled, with a
 * disabled state at each end of history).
 */
function ViewActions({
  channelInput,
  onChannelInputChange,
  syncEnabled,
  onSyncEnabledChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  readonly channelInput: ChannelInput;
  readonly onChannelInputChange: (next: ChannelInput) => void;
  readonly syncEnabled: boolean;
  readonly onSyncEnabledChange: (next: boolean) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 pr-3">
      <SyncToggle enabled={syncEnabled} onEnabledChange={onSyncEnabledChange} />
      <ChannelInputSelector
        value={channelInput}
        onChange={onChannelInputChange}
      />
      {/* Divider — separates the mode toggles from the history actions. */}
      <div className="h-4 w-px shrink-0 bg-chrome-border-subtle" />
      {/* Undo / redo — controlled by the host's comparison-edit history. Ghost
          variant so they recede until hovered; each is disabled (dimmed, inert)
          at its end of history. */}
      <IconButton
        icon="lucide:undo-2"
        label="Undo"
        size={16}
        variant="ghost"
        disabled={!canUndo}
        onClick={onUndo}
      />
      <IconButton
        icon="lucide:redo-2"
        label="Redo"
        size={16}
        variant="ghost"
        disabled={!canRedo}
        onClick={onRedo}
      />
    </div>
  );
}

export function ViewTabs({
  active,
  onActiveChange,
  channelInput,
  onChannelInputChange,
  syncEnabled,
  onSyncEnabledChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ViewTabsProps) {
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
      <ViewActions
        channelInput={channelInput}
        onChannelInputChange={onChannelInputChange}
        syncEnabled={syncEnabled}
        onSyncEnabledChange={onSyncEnabledChange}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
      />
    </div>
  );
}
