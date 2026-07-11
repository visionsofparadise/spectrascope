// DifferenceView renders a single `SourceStrip` against the `derivedAudio`
// prop — the difference signal. Phase 3 routes a placeholder `derivedAudio`
// (the first source's buffer); Phase 5 populates it with the ffmpeg-rendered
// Difference temp file (reference minus the polarity-inverted rest).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChannelInput } from "spectral-display";
import { SourceStrip } from "../SourceStrip";
import type { SourceStripCursorReadout } from "../SourceStrip";
import type { Source } from "../source";
import type { LayerColor } from "../layers";
import { useViewSync } from "../sync";
import type { TransportControl } from "../Transport";
import type { AudioData } from "../spectral/types";
import type { GridMode, ViewControlSettings } from "../viewSettings";
import { FrequencyAxis, DbAxis, TimeRuler } from "../spectral/Axes";
import { FrequencyMinimap } from "../spectral/FrequencyMinimap";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { Selection } from "../spectral/Selection";
import { eventToTime, timeToFraction } from "./viewCursor";

/** Local `#RRGGBB` → `[r,g,b]` helper. Duplicates OverlayView's hexToRgb255. */
function hexToRgb255(hex: string): [number, number, number] {
  const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : cleaned;
  const value = Number.parseInt(expanded, 16);

  if (Number.isNaN(value) || expanded.length !== 6) {
    return [184, 184, 192];
  }

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

interface DifferenceViewProps {
  readonly sources: ReadonlyArray<Source>;
  /**
   * The derived (difference) signal as a single PCM reader. Phase 5 populates
   * this with the ffmpeg-rendered Difference temp file; Phase 3 routes a
   * placeholder.
   */
  readonly derivedAudio: AudioData;
  /** The global Mono/Mid/Side channel-input mode — passed to the strip. */
  readonly channelInput: ChannelInput;
  /** Shared display-control settings, owned by the comparison host. */
  readonly settings: ViewControlSettings;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

/**
 * Per-cell view window — initial fractions mirror OverlayView / TimelineView /
 * SliderView. Interactive zoom/scroll is a future-phase wiring step.
 */
const INITIAL_VIEW_START_FRAC = 0.3;
const INITIAL_VIEW_END_FRAC = 0.5;

/** Empty sync state — no cursor / selection until the user interacts. */
const EMPTY_VIEW_SYNC = {
  cursor: null,
  selection: null,
  timeRange: { start: 0, end: 0 },
} as const;

const DEFAULT_CURSOR: SourceStripCursorReadout = {
  time: "00:00.000",
  freq: "— Hz",
  amp: "— dB",
};

/**
 * Inline `GridOverlay` — same body as OverlayView / TimelineView / SliderView.
 * Chrome is **copied** rather than extracted into a `ViewChrome` render-prop
 * helper. DifferenceView is the fourth copy. With four concrete instances and
 * a fifth (SumView) landing in the same phase, extraction is now a strong
 * candidate — see the plan Notes for Phase 7 documenting the deferral.
 */
function GridOverlay({
  startMs,
  endMs,
  mode,
  opacity,
}: {
  readonly startMs: number;
  readonly endMs: number;
  readonly mode: GridMode;
  readonly opacity: number;
}) {
  const spanMs = endMs - startMs;

  let majorMs = 5000;

  if (spanMs < 2000) majorMs = 200;
  else if (spanMs < 5000) majorMs = 500;
  else if (spanMs < 10000) majorMs = 1000;
  else if (spanMs < 30000) majorMs = 2000;
  else if (spanMs < 60000) majorMs = 5000;
  else majorMs = 10000;

  const timeTicks: Array<number> = [];
  const first = Math.ceil(startMs / majorMs) * majorMs;

  for (let tick = first; tick <= endMs; tick += majorMs) {
    timeTicks.push((tick - startMs) / spanMs);
  }

  const hLines: Array<number> = [];

  if (mode === "freq") {
    const FREQ_MIN = 20;
    const FREQ_MAX = 22050;
    const melMin = 2595 * Math.log10(1 + FREQ_MIN / 700);
    const melMax = 2595 * Math.log10(1 + FREQ_MAX / 700);

    for (const hz of [100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const mel = 2595 * Math.log10(1 + hz / 700);

      hLines.push(1 - (mel - melMin) / (melMax - melMin));
    }
  } else {
    const dbToLinear = (db: number) => Math.pow(10, db / 20);

    for (const db of [-3, -6, -12, -24]) {
      const amp = dbToLinear(db);

      hLines.push((1 - amp) * 0.5);
      hLines.push(0.5 + amp * 0.5);
    }

    hLines.push(0.5);
  }

  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity }}>
      {timeTicks.map((frac) => (
        <div
          key={`t${frac}`}
          className="absolute top-0 bottom-0 w-px bg-chrome-text"
          style={{ left: `${frac * 100}%` }}
        />
      ))}
      {hLines.map((frac, index) => (
        <div
          key={`h${index}`}
          className="absolute left-0 right-0 h-px bg-chrome-text"
          style={{ top: `${frac * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * DifferenceView — single full-pane `<SourceStrip>` rendering a "difference"
 * pseudo-source against the `derivedAudio` prop. The pseudo-source borrows the
 * first visible source's `layerColor` (or a neutral chrome fallback when no
 * sources are visible). Phase 5 feeds `derivedAudio` the ffmpeg-rendered
 * Difference temp file; this phase routes a placeholder.
 *
 * Page-level chrome (grid template + TimeRuler + FrequencyAxis + DbAxis +
 * FrequencyMinimap + GridOverlay + Selection + playhead + cursor readout chip)
 * is unchanged. Display controls (grid / waveform / spectrogram opacity, FFT /
 * hop) now live in the transport and arrive via the shared `settings` prop.
 */
const DIFFERENCE_NEUTRAL_COLOR: LayerColor = {
  primary: "#B8B8C0",
  secondary: "#44444C",
};

export function DifferenceView({
  sources,
  derivedAudio,
  channelInput,
  settings,
  onTransportControlChange,
}: DifferenceViewProps) {
  const [cursorReadout, setCursorReadout] =
    useState<SourceStripCursorReadout>(DEFAULT_CURSOR);
  const [viewStartFrac, setViewStartFrac] = useState(INITIAL_VIEW_START_FRAC);
  const [viewEndFrac, setViewEndFrac] = useState(INITIAL_VIEW_END_FRAC);

  // Reserved for future zoom/scroll wiring.
  void setViewStartFrac;
  void setViewEndFrac;

  // Cross-view sync — the inspection cursor / selection (shared when the
  // global Sync toggle is on, local otherwise).
  const viewSync = useViewSync("difference", EMPTY_VIEW_SYNC);

  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const durationSec = derivedAudio.durationMs / 1000;

  const startMs = derivedAudio.durationMs * viewStartFrac;
  const endMs = derivedAudio.durationMs * viewEndFrac;

  const visibleSources = useMemo(
    () => sources.filter((source) => source.visible),
    [sources],
  );

  // Audibility — reserved for future audio-pipeline wiring.
  const anySoloed = sources.some((source) => source.soloed);
  const audibleSources = anySoloed
    ? sources.filter((source) => source.soloed)
    : sources.filter((source) => !source.muted && source.visible);

  void audibleSources;

  /**
   * Synthesised "difference" pseudo-source. Borrows the first visible
   * source's color, or a neutral chrome pair when nothing is visible.
   */
  const differenceSource = useMemo<Source>(() => {
    const anchorColor = visibleSources[0]?.layerColor ?? DIFFERENCE_NEUTRAL_COLOR;

    return {
      id: "difference",
      name: "Difference",
      audioFilePath: "derived",
      timelineOffsetMs: 0,
      layerColor: anchorColor,
      visible: true,
      muted: false,
      soloed: false,
    };
  }, [visibleSources]);

  const onPlayToggle = useCallback(() => {
    setPlaying((prev) => !prev);
  }, []);

  const onSeek = useCallback(
    (sec: number) => {
      setPositionSec(Math.max(0, Math.min(durationSec, sec)));
    },
    [durationSec],
  );

  // Place the inspection cursor at the clicked time (sync-aware).
  const handleCursorClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const time = eventToTime(event, startMs, endMs);

      if (time !== null) viewSync.setCursor(time);
    },
    [viewSync, startMs, endMs],
  );

  const transportControl = useMemo<TransportControl>(
    () => ({
      playing,
      positionSec,
      durationSec,
      onPlayToggle,
      onSeek,
      cursorReadout,
      // Selection range — driven by the (sync-aware) selection; `—` columns
      // when nothing is selected.
      selectionInSec:
        viewSync.selection !== null ? viewSync.selection.start / 1000 : undefined,
      selectionOutSec:
        viewSync.selection !== null ? viewSync.selection.end / 1000 : undefined,
    }),
    [
      playing,
      positionSec,
      durationSec,
      onPlayToggle,
      onSeek,
      cursorReadout,
      viewSync.selection,
    ],
  );

  useEffect(() => {
    if (onTransportControlChange) {
      onTransportControlChange(transportControl);
    }
  }, [onTransportControlChange, transportControl]);

  // Cursor / selection display fractions within the content window.
  const cursorFrac = timeToFraction(viewSync.cursor, startMs, endMs);
  const selectionStartFrac = timeToFraction(
    viewSync.selection?.start ?? null,
    startMs,
    endMs,
  );
  const selectionEndFrac = timeToFraction(
    viewSync.selection?.end ?? null,
    startMs,
    endMs,
  );

  // Frequency minimap mirrors the strip's color anchor.
  const minimapLayerColor = differenceSource.layerColor;

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-void">
      <div
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
        style={{
          display: "grid",
          gridTemplateColumns: "2.5rem minmax(0, 1fr) auto auto",
          gridTemplateRows: "2rem minmax(0, 1fr) 2rem",
        }}
      >
        {/* Row 1: blank | ruler | blank | blank */}
        <div className="bg-void" />
        <TimeRuler startMs={startMs} endMs={endMs} />
        <div className="bg-void" />
        <div className="bg-void" />

        {/* Row 2: freq axis | content cell | freq minimap | dB axis */}
        <FrequencyAxis />

        {/* Content cell — one full-pane SourceStrip of the difference
            pseudo-source. Clicking places the inspection cursor (sync-aware). */}
        <div
          className="relative cursor-crosshair overflow-hidden bg-void"
          onClick={handleCursorClick}
        >
          <SourceStrip
            source={differenceSource}
            audioData={derivedAudio}
            startMs={startMs}
            endMs={endMs}
            fftSize={settings.fftSize}
            hopOverlap={settings.hopOverlap}
            channelInput={channelInput}
            waveformOpacity={settings.waveformOpacity}
            spectrogramOpacity={settings.spectrogramOpacity}
            onCursorMove={setCursorReadout}
          />
          <GridOverlay
            startMs={startMs}
            endMs={endMs}
            mode={settings.gridMode}
            opacity={settings.gridOpacity}
          />
          {selectionStartFrac !== null && selectionEndFrac !== null && (
            <Selection
              startFraction={selectionStartFrac}
              endFraction={selectionEndFrac}
            />
          )}
          {cursorFrac !== null && cursorFrac >= 0 && cursorFrac <= 1 && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-data-cursor"
              style={{ left: `${cursorFrac * 100}%` }}
            />
          )}
          {/* The cursor readout is published up to the Transport (see
              `transportControl.cursorReadout`); no in-pane readout chip. */}
        </div>

        <FrequencyMinimap
          audioData={derivedAudio}
          startMs={startMs}
          endMs={endMs}
          layerColor={minimapLayerColor}
        />
        <DbAxis />

        {/* Row 3: blank | horizontal MinimapDisplay | blank | blank. Pairs
            with the vertical FrequencyMinimap to give a 2D zoom/pan overview. */}
        <div className="bg-void" />
        <MinimapDisplay
          audioData={derivedAudio}
          viewStartFrac={viewStartFrac}
          viewEndFrac={viewEndFrac}
          waveformColor={hexToRgb255(minimapLayerColor.primary)}
        />
        <div className="bg-void" />
        <div className="bg-void" />
      </div>
    </div>
  );
}
