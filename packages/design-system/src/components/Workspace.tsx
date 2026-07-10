import { useState } from "react";
import type { ChannelInput } from "spectral-display";
import type { Source } from "../source";
import type { TransportControl } from "./spectral/Transport";
import type { AudioData } from "./spectral/types";
import { ViewTabs } from "./ViewTabs";
import type { ViewId } from "./ViewTabs";
import { CorrelationView } from "./views/CorrelationView";
import { DifferenceView } from "./views/DifferenceView";
import { FrequencyDistributionView } from "./views/FrequencyDistributionView";
import { LoudnessView } from "./views/LoudnessView";
import { OverlayView } from "./views/OverlayView";
import { SliderView } from "./views/SliderView";
import { SumView } from "./views/SumView";
import { TimelineView } from "./views/TimelineView";
import { VectorscopeView } from "./views/VectorscopeView";

interface WorkspaceProps {
  /**
   * Per-source PCM readers, keyed by `Source.id`. Each source carries its own
   * decoded audio rather than the whole workspace sharing one buffer — the
   * source/chart views look up each source's `AudioData` here and hand it to
   * that source's `SourceStrip` / trace. A source absent from the map has no
   * audio yet (still decoding, or import failed) and is skipped by the views.
   * An empty map renders an empty workspace.
   */
  readonly sourceAudio: ReadonlyMap<string, AudioData>;
  /**
   * The derived (Sum / Difference) signal as a single PCM reader. Phase 5
   * populates this with the ffmpeg-rendered temp file; Phase 3 routes a
   * placeholder so the two derived views stay green.
   */
  readonly derivedAudio: AudioData;
  readonly sources: ReadonlyArray<Source>;
  /**
   * The active view tab. Controlled — the host owns which view is shown so it
   * can resolve view-specific data (e.g. the desktop app renders the ffmpeg
   * Sum vs Difference derived signal for whichever derived view is active).
   * Changes are emitted via `onActiveViewChange`.
   */
  readonly activeView: ViewId;
  readonly onActiveViewChange: (id: ViewId) => void;
  /**
   * Whether cross-view sync is on. Controlled — the host owns the on/off
   * state and threads it down; `Workspace` only forwards it to the `ViewTabs`
   * Sync toggle. The shared sync state itself lives in a `SyncProvider` the
   * host mounts around the workspace.
   */
  readonly syncEnabled: boolean;
  readonly onSyncEnabledChange: (next: boolean) => void;
  /**
   * Undo / redo the host's comparison-edit history. Controlled — `Workspace`
   * only forwards these to the `ViewTabs` actions cluster; the history stack
   * lives in the host (the desktop app's `useComparisonHistory`). `canUndo` /
   * `canRedo` drive the buttons' disabled state. The demo passes no-ops with
   * both flags `false`.
   */
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * Emitted when a source is dragged on the Timeline view — `(sourceId,
   * offsetMs)` with `offsetMs ≥ 0`. Forwarded straight to `TimelineView`; the
   * other views do not place strips by offset. When omitted, the Timeline
   * still lays strips out by offset but renders no drag affordance.
   */
  readonly onSourceOffsetChange?: (sourceId: string, offsetMs: number) => void;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

/**
 * Workspace — the workspace pane composition. The active view is a controlled
 * prop (`activeView` / `onActiveViewChange`) so the host can resolve
 * view-specific data; `channelInput` stays workspace-owned. Renders the
 * `ViewTabs` strip on top and the active view container in the body.
 *
 * Cross-view sync: `syncEnabled` is a controlled prop forwarded to the
 * `ViewTabs` Sync toggle. The shared cursor / selection / time-range state is
 * NOT owned here — the host mounts a `<SyncProvider>` (with the same
 * `enabled` flag) around the `Workspace`, and the views consume it via
 * `useViewSync`. When sync is off each view uses its own local state.
 *
 * Transport-control plumbing: the active view publishes its `TransportControl`
 * up via the `onTransportControlChange` callback. Workspace forwards that
 * callback to the active view as a child prop — no context, no ref, no
 * render-prop. Switching tabs unmounts the old view and mounts the new one;
 * the new view's own mount effect publishes its control. No debounce step is
 * needed — every view publishes on mount, and React runs the newly-mounted
 * child's effect within the same commit.
 *
 * Audio resolution: the seven source/chart views receive the `sourceAudio`
 * map and look up per-source `AudioData` by id; the two derived views
 * (`SumView`, `DifferenceView`) receive the single `derivedAudio` reader.
 */
export function Workspace({
  sources,
  sourceAudio,
  derivedAudio,
  activeView,
  onActiveViewChange,
  syncEnabled,
  onSyncEnabledChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSourceOffsetChange,
  onTransportControlChange,
}: WorkspaceProps) {
  // The global Mono/Mid/Side channel-input mode. Owned here so the ViewTabs
  // selector and every per-source view read the same value. It is inert on the
  // chart views (Frequency Distribution, Loudness) — they are not passed it.
  const [channelInput, setChannelInput] = useState<ChannelInput>("mono");

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-void">
      <ViewTabs
        active={activeView}
        onActiveChange={onActiveViewChange}
        channelInput={channelInput}
        onChannelInputChange={setChannelInput}
        syncEnabled={syncEnabled}
        onSyncEnabledChange={onSyncEnabledChange}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeView === "timeline" && (
          <TimelineView
            sources={sources}
            sourceAudio={sourceAudio}
            channelInput={channelInput}
            onSourceOffsetChange={onSourceOffsetChange}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "overlay" && (
          <OverlayView
            sources={sources}
            sourceAudio={sourceAudio}
            channelInput={channelInput}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "slider" && (
          <SliderView
            sources={sources}
            sourceAudio={sourceAudio}
            channelInput={channelInput}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "difference" && (
          <DifferenceView
            sources={sources}
            derivedAudio={derivedAudio}
            channelInput={channelInput}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "sum" && (
          <SumView
            sources={sources}
            derivedAudio={derivedAudio}
            channelInput={channelInput}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "frequency-distribution" && (
          <FrequencyDistributionView
            sources={sources}
            sourceAudio={sourceAudio}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "loudness" && (
          <LoudnessView
            sources={sources}
            sourceAudio={sourceAudio}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "correlation" && (
          <CorrelationView
            sources={sources}
            sourceAudio={sourceAudio}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "vectorscope" && (
          <VectorscopeView
            sources={sources}
            sourceAudio={sourceAudio}
            onTransportControlChange={onTransportControlChange}
          />
        )}
      </div>
    </div>
  );
}
