import { useState } from "react";
import type { Source } from "../source";
import type { TransportControl } from "./spectral/Transport";
import type { AudioData } from "./spectral/types";
import { ViewTabs } from "./ViewTabs";
import type { ViewId } from "./ViewTabs";
import { DifferenceView } from "./views/DifferenceView";
import { FrequencyDistributionView } from "./views/FrequencyDistributionView";
import { LoudnessView } from "./views/LoudnessView";
import { OverlayView } from "./views/OverlayView";
import { SliderView } from "./views/SliderView";
import { SumView } from "./views/SumView";
import { TimelineView } from "./views/TimelineView";

interface WorkspaceProps {
  /**
   * Streaming PCM reader (the `spectral-display` package type:
   * `{ sampleRate, totalSamples, channels, durationMs, readSamples }`). Phase
   * 4 upgraded this from the previous synthesised `AudioDisplayData` to a
   * real PCM reader so `SourceStrip` (via `useSpectralCompute`) can render
   * against actual audio. The consumer loads the buffer (e.g. via
   * `loadAudio("/test-voice.wav")`) and threads it down here.
   */
  readonly audioData: AudioData;
  readonly sources: ReadonlyArray<Source>;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

/**
 * Workspace — the workspace pane composition. Owns the active-view state
 * internally for the first pass. Renders the `ViewTabs` strip on top and the
 * active view container in the body.
 *
 * Per the workspace-shell plan's Phase 3 contract, only `OverlayView` is real
 * this pass; the other six tabs render a labelled placeholder pointing at the
 * phase that will implement them.
 *
 * Transport-control plumbing: the active view publishes its `TransportControl`
 * up via the `onTransportControlChange` callback. Workspace forwards that
 * callback to the active view as a child prop — no context, no ref, no
 * render-prop. Switching tabs unmounts the old view and mounts the new one;
 * the new view's own mount effect publishes its control. No debounce step is
 * needed — every view publishes on mount, and React runs the newly-mounted
 * child's effect within the same commit.
 */
export function Workspace({ sources, audioData, onTransportControlChange }: WorkspaceProps) {
  const [activeView, setActiveView] = useState<ViewId>("overlay");

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-void">
      <ViewTabs active={activeView} onActiveChange={setActiveView} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeView === "timeline" && (
          <TimelineView
            sources={sources}
            audioData={audioData}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "overlay" && (
          <OverlayView
            sources={sources}
            audioData={audioData}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "slider" && (
          <SliderView
            sources={sources}
            audioData={audioData}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "difference" && (
          <DifferenceView
            sources={sources}
            audioData={audioData}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "sum" && (
          <SumView
            sources={sources}
            audioData={audioData}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "frequency-distribution" && (
          <FrequencyDistributionView
            sources={sources}
            audioData={audioData}
            onTransportControlChange={onTransportControlChange}
          />
        )}
        {activeView === "loudness" && (
          <LoudnessView
            sources={sources}
            audioData={audioData}
            onTransportControlChange={onTransportControlChange}
          />
        )}
      </div>
    </div>
  );
}
