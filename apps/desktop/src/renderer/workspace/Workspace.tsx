import type { ChannelInput } from "spectral-display";
import type { Source } from "./source";
import type { TransportControl } from "./Transport";
import type { AudioData } from "./spectral/types";
import type { ViewControlSettings } from "./viewSettings";
import { CorrelationView } from "./views/CorrelationView";
import { DifferenceView } from "./views/DifferenceView";
import { FrequencyDistributionView } from "./views/FrequencyDistributionView";
import { LoudnessView } from "./views/LoudnessView";
import { OverlayView } from "./views/OverlayView";
import { SliderView } from "./views/SliderView";
import { SumView } from "./views/SumView";
import { TimelineView } from "./views/TimelineView";
import { VectorscopeView } from "./views/VectorscopeView";

/**
 * The nine workspace views. The union values are the code's stable view ids;
 * their display labels (including "Freq Dist" for `frequency-distribution`)
 * live with the `Sidebar` View selector that renders them.
 */
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
   * The active derived (Sum / Difference) signal as a single PCM reader, backed
   * by the registered `media://` stream for whichever derived view is active.
   */
  readonly derivedAudio: AudioData;
  readonly sources: ReadonlyArray<Source>;
  /**
   * The active view. Controlled — the host owns which view is shown so it can
   * resolve view-specific data (e.g. the desktop app routes the Sum vs
   * Difference stream for whichever derived view is active). The selector lives
   * in the `Sidebar`; `Workspace` only renders the active view.
   */
  readonly activeView: ViewId;
  /**
   * The global Mono/Mid/Side channel-input mode. Controlled — persisted on the
   * comparison and threaded into every per-source spectrogram view plus
   * Frequency Distribution (whose LTAS folds the same channel input). Inert on
   * Correlation and Vectorscope, which are not passed it.
   */
  readonly channelInput: ChannelInput;
  /**
   * The shared display-control settings, owned by the comparison host and
   * consumed by the five SourceStrip views + Loudness + Frequency Distribution
   * (FFT size / hop overlap). Correlation and Vectorscope take none.
   */
  readonly settings: ViewControlSettings;
  /**
   * The Difference view's A/B source selection (source ids), or `null` until the
   * sticky default is written. Threaded into `DifferenceView`'s selector row;
   * the other views ignore it.
   */
  readonly differenceA: string | null;
  readonly differenceB: string | null;
  /**
   * Emitted when the Difference A/B selection changes — `(differenceA,
   * differenceB)` source ids. The host persists both fields as one
   * history-participating `"difference"` edit, and the diff stream re-registers.
   */
  readonly onDifferenceChange: (differenceA: string, differenceB: string) => void;
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
 * Workspace — the workspace pane composition. The active view and the
 * `channelInput` mode are both controlled props (owned by the comparison host,
 * selected from the `Sidebar`) so the host can resolve view-specific data and
 * persist channel input. There is no strip above the pane — `Workspace` renders
 * only the active view container.
 *
 * Cross-view sync: the Sync toggle now lives in the transport's Timeline
 * controls (host-owned), not here. The shared cursor / selection / time-range
 * state is NOT owned by `Workspace` — the host mounts a `<SyncProvider>`
 * around it, and the views consume it via `useViewSync`. When sync is off each
 * view uses its own local state.
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
  channelInput,
  settings,
  differenceA,
  differenceB,
  onDifferenceChange,
  onSourceOffsetChange,
  onTransportControlChange,
}: WorkspaceProps) {
  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-void">
      {activeView === "timeline" && (
          <TimelineView
            sources={sources}
            sourceAudio={sourceAudio}
            channelInput={channelInput}
            settings={settings}
            onSourceOffsetChange={onSourceOffsetChange}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "overlay" && (
          <OverlayView
            sources={sources}
            sourceAudio={sourceAudio}
            channelInput={channelInput}
            settings={settings}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "slider" && (
          <SliderView
            sources={sources}
            sourceAudio={sourceAudio}
            channelInput={channelInput}
            settings={settings}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "difference" && (
          <DifferenceView
            sources={sources}
            derivedAudio={derivedAudio}
            channelInput={channelInput}
            settings={settings}
            differenceA={differenceA}
            differenceB={differenceB}
            onDifferenceChange={onDifferenceChange}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "sum" && (
          <SumView
            sources={sources}
            derivedAudio={derivedAudio}
            channelInput={channelInput}
            settings={settings}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "frequency-distribution" && (
          <FrequencyDistributionView
            sources={sources}
            sourceAudio={sourceAudio}
            settings={settings}
            channelInput={channelInput}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "loudness" && (
          <LoudnessView
            sources={sources}
            sourceAudio={sourceAudio}
            settings={settings}
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
  );
}
