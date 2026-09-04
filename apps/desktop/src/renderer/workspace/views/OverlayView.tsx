import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChannelInput } from "spectral-display";
import { SourceRender } from "../SourceRender";
import type { SourceRenderCursorReadout } from "../SourceRender";
import type { Source } from "../source";
import { useViewSync } from "../sync";
import type { TransportControl } from "../Transport";
import type { AudioData } from "../spectral/types";
import type { GridMode, ViewControlSettings } from "../viewSettings";
import { FrequencyAxis, DbAxis, TimeRuler } from "../spectral/Axes";
import { FrequencyMinimap } from "../spectral/FrequencyMinimap";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { Selection } from "../spectral/Selection";
import { useTimeViewport } from "../useTimeViewport";
import { EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";
import { eventToTime, timeToFraction } from "./viewCursor";

/**
 * Local `#RRGGBB` → `[r, g, b]` helper. Duplicates SourceRender's hexToRgb255
 * because the strip keeps it private. If a third caller appears, lift to a
 * shared util (`components/spectral/colorUtil.ts`).
 */
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

interface OverlayViewProps {
  readonly sources: ReadonlyArray<Source>;
  /** Per-source PCM readers, keyed by `Source.id`. */
  readonly sourceAudio: ReadonlyMap<string, AudioData>;
  /** The global Mono/Mid/Side channel-input mode — passed to every strip. */
  readonly channelInput: ChannelInput;
  /** Shared display-control settings, owned by the comparison host. */
  readonly settings: ViewControlSettings;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

/** Empty sync state — no cursor / selection until the user interacts. */
const EMPTY_VIEW_SYNC = {
  cursor: null,
  selection: null,
} as const;

const DEFAULT_CURSOR: SourceRenderCursorReadout = {
  time: "00:00.000",
  freq: "— Hz",
  amp: "— dB",
};

/**
 * Inline `GridOverlay` — ported from the pre-deletion SpectralPage reference
 * (`archive/spectralpage-reference.tsx` lines ~124-191). Kept as a private
 * helper for now per the Phase 4.2 judgment call; promote to a shared
 * `components/views/GridOverlay.tsx` once a second view needs it.
 *
 * Renders vertical time-grid lines (matched to the `TimeRuler`'s major ticks)
 * and horizontal lines that switch between mel-spaced frequency lines and
 * symmetric dB amplitude lines depending on `mode`. Opacity is parent-owned.
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
    // Frequency lines — mel scale positions matching FrequencyAxis.
    const FREQ_MIN = 20;
    const FREQ_MAX = 22050;
    const melMin = 2595 * Math.log10(1 + FREQ_MIN / 700);
    const melMax = 2595 * Math.log10(1 + FREQ_MAX / 700);

    for (const hz of [100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const mel = 2595 * Math.log10(1 + hz / 700);

      hLines.push(1 - (mel - melMin) / (melMax - melMin));
    }
  } else {
    // Amplitude lines — dB positions matching the symmetric DbAxis.
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
 * OverlayView — every visible source's `SourceRender` z-stacked in the same
 * viewport, blended via `mix-blend-mode: lighten`. The documented exception
 * to the no-opacity-for-data rule: for this view, the blend mode *is* the
 * data composition.
 *
 * Structural template: ported from the pre-deletion SpectralPage's
 * `SpectralPage` function (`archive/spectralpage-reference.tsx` lines ~327-575).
 * Keeps the SpectralPage grid layout and frequency minimap. The **content
 * cell** (row 2 col 2) is now N stacked `<SourceRender>` instances inside a
 * `mix-blend-mode: lighten` wrapper, plus a single shared `<GridOverlay>` +
 * `<Selection>` + playhead cursor line owned by the view. Display controls
 * (grid / waveform / spectrogram opacity, FFT / hop) live in the transport's
 * left region and arrive via the shared `settings` prop.
 *
 * Phase 4 deferrals (recorded in the workspace-shell plan Notes):
 * - The DemoTabBar / top-bar / source-pickers / A-B knobs / node-nav from the
 *   SpectralPage reference are gone — the sidebar's View selector replaces
 *   them, and the Sources Panel handles per-source picking.
 * - The stereo meter from the SpectralPage right column is gone — it didn't
 *   generalize across N sources; pending follow-up.
 * - Cursor readout (`time/freq/amp`) is held as local state and shown as an
 *   unobtrusive overlay in the bottom-left of the content cell. The Phase 1
 *   stripped Transport doesn't render readouts; wiring readouts back into
 *   Transport is deferred.
 * - The view window (`startMs/endMs`) is the committed window of a per-view
 *   `useTimeViewport` — scroll pans, ctrl+scroll zooms about the cursor, and a
 *   minimap click/drag recentres it.
 * - Each source carries its own `AudioData` (resolved from the `sourceAudio`
 *   map by id); the shared view chrome sizes against the first renderable
 *   source's audio.
 *
 * Cross-view sync (Phase 7): the inspection cursor and selection come from
 * `useViewSync` — the shared `SyncProvider` state when the global Sync toggle
 * is on, the view's own local state when it is off. Clicking the content cell
 * places the cursor at that time (absolute ms); with sync on, every synced
 * view's cursor line moves together.
 *
 * Layer opacity: `settings.waveformOpacity` / `settings.spectrogramOpacity`
 * route into the `SourceRender` layer-opacity props. `settings.loudnessOpacity`
 * has no layer in `SourceRender` (it has no loudness layer) and is unconsumed.
 *
 * Audibility rule (solo overrides mute) is computed for downstream audio
 * pipeline consumption; the visual stack uses `visible === true` only.
 */
export function OverlayView({
  sources,
  sourceAudio,
  channelInput,
  settings,
  onTransportControlChange,
}: OverlayViewProps) {
  const [cursorReadout, setCursorReadout] =
    useState<SourceRenderCursorReadout>(DEFAULT_CURSOR);

  // Cross-view sync — the inspection cursor / selection. Shared `SyncProvider`
  // state when the global Sync toggle is on, this view's own local state when
  // off.
  const viewSync = useViewSync("overlay", EMPTY_VIEW_SYNC);

  // Visible sources that have decoded audio, paired with their `AudioData`.
  const renderableSources = useMemo(
    () => resolveVisibleSourceAudio(sources, sourceAudio),
    [sources, sourceAudio],
  );

  // Shared view chrome (time ruler, minimaps, duration) sizes against the
  // first renderable source's audio; an empty zero-duration fallback when none.
  const chromeAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;

  // Transient time viewport — extent is the first renderable source's duration.
  // The committed window feeds the strips / ruler; the live window drives the
  // minimap bracket and the gesture transform.
  const viewport = useTimeViewport(0, chromeAudio.durationMs);
  const startMs = viewport.committedStartMs;
  const endMs = viewport.committedEndMs;

  const setViewportToFraction = useCallback(
    (fraction: number) => {
      const centerMs = fraction * chromeAudio.durationMs;
      const span = viewport.endMs - viewport.startMs;

      viewport.setViewport({ startMs: centerMs - span / 2, endMs: centerMs + span / 2 });
    },
    [chromeAudio.durationMs, viewport],
  );

  const viewStartFrac =
    chromeAudio.durationMs > 0 ? viewport.startMs / chromeAudio.durationMs : 0;
  const viewEndFrac =
    chromeAudio.durationMs > 0 ? viewport.endMs / chromeAudio.durationMs : 1;

  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const durationSec = chromeAudio.durationMs / 1000;

  // Audibility — solo overrides mute. Reserved for future audio-pipeline
  // wiring; the visual stack uses `visible === true` only.
  const anySoloed = sources.some((source) => source.soloed);
  const audibleSources = anySoloed
    ? sources.filter((source) => source.soloed)
    : sources.filter((source) => !source.muted && source.visible);

  void audibleSources;

  const onPlayToggle = useCallback(() => {
    setPlaying((prev) => !prev);
  }, []);

  const onSeek = useCallback(
    (sec: number) => {
      setPositionSec(Math.max(0, Math.min(durationSec, sec)));
    },
    [durationSec],
  );

  // Place the inspection cursor at the clicked time (absolute ms within the
  // content window). Routes through `useViewSync`, so with the global Sync
  // toggle on the cursor is shared across every synced view.
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
      // Selection range — surfaces as the transport's In / Out columns. Driven
      // by the (sync-aware) selection; `—` columns when nothing is selected.
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

  // Use the first renderable source's color for the frequency minimap (it's a
  // single-source overview; with N sources the choice is arbitrary — pick the
  // first stable renderable).
  const minimapLayerColor =
    renderableSources[0]?.source.layerColor ?? {
      primary: "#B8B8C0",
      secondary: "#44444C",
    };

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-void">
      {/* Main grid — ported from SpectralPage reference (lines ~466-493). */}
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

        {/* Content cell — N stacked SourceRenders + shared view chrome.
            Clicking places the inspection cursor (sync-aware); scroll pans,
            ctrl+scroll zooms (the viewport's non-passive wheel listener binds
            to this element's ref). */}
        <div
          ref={viewport.wheelHandlers.ref}
          className="relative cursor-crosshair overflow-hidden bg-void"
          onClick={handleCursorClick}
        >
          {renderableSources.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-body text-sm text-chrome-text-secondary">
                No visible sources.
              </p>
            </div>
          ) : (
            <>
              {/* Render stack — each `SourceRender` maps its own held render onto
                  the live window; this wrapper only carries the blend mode. */}
              <div
                className="absolute inset-0"
                style={{ mixBlendMode: "lighten" }}
              >
                {renderableSources.map(({ source, audioData }) => (
                  <SourceRender
                    key={source.id}
                    source={source}
                    audioData={audioData}
                    startMs={startMs}
                    endMs={endMs}
                    liveStartMs={viewport.startMs}
                    liveEndMs={viewport.endMs}
                    fftSize={settings.fftSize}
                    hopOverlap={settings.hopOverlap}
                    channelInput={channelInput}
                    opacity={0.5}
                    waveformOpacity={settings.waveformOpacity}
                    spectrogramOpacity={settings.spectrogramOpacity}
                    onCursorMove={setCursorReadout}
                  />
                ))}
              </div>
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
              {/* The time / freq / amp cursor readout is published up to the
                  Transport (see `transportControl.cursorReadout`); the view
                  itself draws no in-pane readout chip. */}
            </>
          )}
        </div>

        <FrequencyMinimap
          audioData={chromeAudio}
          startMs={startMs}
          endMs={endMs}
          layerColor={minimapLayerColor}
        />
        <DbAxis />

        {/* Row 3: blank | horizontal MinimapDisplay | blank | blank.
            Pairs with the vertical FrequencyMinimap in row 2 col 3 to give
            the user a 2D zoom/pan overview. Waveform color is the first
            visible source's `layerColor.primary` — arbitrary with N sources;
            the first stable visible matches the FrequencyMinimap choice. */}
        <div className="bg-void" />
        <MinimapDisplay
          audioData={chromeAudio}
          viewStartFrac={viewStartFrac}
          viewEndFrac={viewEndFrac}
          waveformColor={hexToRgb255(minimapLayerColor.primary)}
          onScrubToFraction={setViewportToFraction}
        />
        <div className="bg-void" />
        <div className="bg-void" />
      </div>
    </div>
  );
}
