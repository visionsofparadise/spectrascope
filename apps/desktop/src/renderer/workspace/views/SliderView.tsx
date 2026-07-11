import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChannelInput } from "spectral-display";
import { SourceStrip } from "../SourceStrip";
import type { SourceStripCursorReadout } from "../SourceStrip";
import type { Source } from "../source";
import { useViewSync } from "../sync";
import { Curtain } from "../spectral/Curtain";
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
import { curtainBounds, defaultCurtainPositions, stripClipPath } from "./sliderClip";

/**
 * Local `#RRGGBB` → `[r, g, b]` helper. Duplicates the one in OverlayView /
 * SourceStrip; lift to a shared util when a fourth caller appears.
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

interface SliderViewProps {
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

const DEFAULT_CURSOR: SourceStripCursorReadout = {
  time: "00:00.000",
  freq: "— Hz",
  amp: "— dB",
};

/**
 * Inline `GridOverlay` — same body as OverlayView / TimelineView. Per the
 * Phase 5 judgment call (carried into Phase 6), the shared view-level chrome
 * is **copied** between the per-source views rather than extracted into a
 * `ViewChrome` render-prop helper. SliderView is the third copy. With three
 * concrete instances landed, extraction is now a real candidate — flagged in
 * the plan Notes for Phase 6 as a follow-up rather than landed here.
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
 * SliderView — wipe-compare across N sources. Each renderable source's
 * `<SourceStrip>` is z-stacked at full opacity and clipped two-sided to the
 * band between its neighbouring curtains (`sliderClip.stripClipPath`), so strip
 * `k` shows only in `[positions[k−1], positions[k]]`. `N−1` `<Curtain>` handles
 * sit between adjacent sources; each clamps between its neighbours
 * (`sliderClip.curtainBounds`) so handles cannot cross, and earlier handles
 * stack above later ones. Positions start all at the right edge (source 1 fills
 * the view) and reset when the renderable-source id list changes.
 *
 * Page-level chrome (grid template + TimeRuler + FrequencyAxis + DbAxis +
 * FrequencyMinimap + GridOverlay + Selection + playhead + cursor readout chip)
 * is identical to OverlayView and TimelineView. Display controls live in the
 * transport's left region and arrive via the shared `settings` prop.
 *
 * Judgment calls (recorded in the plan):
 *   - **<2 renderable sources**: content cell shows a "Need at least two
 *     visible sources" message in `font-technical text-sm text-chrome-text-dim`.
 *     The rest of the page chrome stays mounted so the view remains navigable.
 *     A source is renderable when it is visible *and* has decoded audio.
 *   - **Audio-playback switching at the handle is out of scope.** The published
 *     `TransportControl` mirrors OverlayView/TimelineView — visual-only.
 *   - **Curtain positions are transient view-local state** — not persisted, not
 *     in undo history (like layer opacity); `Curtain`'s continuous
 *     `onPositionChange` is fine.
 */
export function SliderView({
  sources,
  sourceAudio,
  channelInput,
  settings,
  onTransportControlChange,
}: SliderViewProps) {
  const [cursorReadout, setCursorReadout] =
    useState<SourceStripCursorReadout>(DEFAULT_CURSOR);

  // Cross-view sync — the inspection cursor / selection (shared when the
  // global Sync toggle is on, local otherwise).
  const viewSync = useViewSync("slider", EMPTY_VIEW_SYNC);

  // Visible sources that have decoded audio, paired with their `AudioData`.
  const renderableSources = useMemo(
    () => resolveVisibleSourceAudio(sources, sourceAudio),
    [sources, sourceAudio],
  );

  const sourceCount = renderableSources.length;

  // Curtain positions — `N−1` fractions, one per adjacent-source boundary,
  // transient view-local state. Reset to the right edge (source 1 full-width)
  // whenever the renderable-source id list changes; keyed off the id list so an
  // unrelated re-render (audio recompute, chrome resize) does not thrash them.
  const idsKey = useMemo(
    () => renderableSources.map((entry) => entry.source.id).join("|"),
    [renderableSources],
  );

  const [positions, setPositions] = useState<Array<number>>(() =>
    defaultCurtainPositions(sourceCount),
  );
  const [positionsKey, setPositionsKey] = useState(idsKey);

  if (positionsKey !== idsKey) {
    setPositionsKey(idsKey);
    setPositions(defaultCurtainPositions(sourceCount));
  }

  const setCurtainAt = useCallback((index: number, next: number) => {
    setPositions((previous) => {
      const updated = previous.slice();

      updated[index] = next;

      return updated;
    });
  }, []);

  // Shared chrome (time ruler, minimaps, duration) sizes against the first
  // renderable source's audio; a zero-duration fallback when none.
  const chromeAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;

  // Transient time viewport — extent is the first renderable source's duration.
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

  const hasSources = sourceCount >= 2;

  // Frequency minimap is a single-source overview. With a wipe across N sources
  // the choice is arbitrary — pick the first (leftmost) source's color, falling
  // back to a neutral chrome pair when none.
  const minimapLayerColor =
    renderableSources[0]?.source.layerColor ?? {
      primary: "#B8B8C0",
      secondary: "#44444C",
    };

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

        {/* Content cell — wipe-compare. N SourceStrips z-stacked, each clipped
            two-sided to its band; N−1 Curtains render the draggable boundaries.
            Clicking places the inspection cursor (sync-aware). */}
        <div
          ref={viewport.wheelHandlers.ref}
          className="relative cursor-crosshair overflow-hidden bg-void"
          onClick={handleCursorClick}
        >
          {hasSources ? (
            <>
              {/* Strip stack — the gesture `transform` maps the committed render
                  onto the live window during a scroll/zoom. The Curtain handles
                  and shared chrome stay in container space (untransformed). Each
                  strip is clipped two-sided to its band; visibility is geometric
                  (the clip), not paint order. */}
              <div
                className="absolute inset-0"
                style={{ transform: viewport.transform, transformOrigin: "left" }}
              >
                {renderableSources.map((entry, index) => (
                  <SourceStrip
                    key={entry.source.id}
                    source={entry.source}
                    audioData={entry.audioData}
                    startMs={startMs}
                    endMs={endMs}
                    fftSize={settings.fftSize}
                    hopOverlap={settings.hopOverlap}
                    channelInput={channelInput}
                    clipPath={stripClipPath(index, positions, sourceCount)}
                    waveformOpacity={settings.waveformOpacity}
                    spectrogramOpacity={settings.spectrogramOpacity}
                    onCursorMove={setCursorReadout}
                  />
                ))}
              </div>
              {/* N−1 draggable handles, one per adjacent-source boundary. Each
                  Curtain reads its parent rect for dragging, so it sits in a
                  full-size wrapper that is a direct child of this
                  `position: relative` content cell. Wrappers carry a descending
                  z-index (earlier handles on top) so overlapping handles resolve
                  to the earlier source. */}
              {positions.map((position, index) => {
                const bounds = curtainBounds(index, positions);

                return (
                  <div
                    key={renderableSources[index]?.source.id ?? index}
                    className="pointer-events-none absolute inset-0"
                    style={{ zIndex: positions.length - index }}
                  >
                    <Curtain
                      position={position}
                      min={bounds.min}
                      max={bounds.max}
                      onPositionChange={(next) => {
                        setCurtainAt(index, next);
                      }}
                    />
                  </div>
                );
              })}
              {/* Shared chrome — overlays the entire content cell, above the
                  clip-pathed strips. */}
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
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="font-technical text-sm text-chrome-text-dim">
                Need at least two visible sources
              </p>
            </div>
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
            Top (foreground) source's color drives the waveform; falls back to
            chrome neutral when no pair (the bracket still gives navigational
            context even with no strips). */}
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
