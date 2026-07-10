import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChannelInput } from "spectral-display";
import { Knob } from "../controls/Knob";
import { IconButton } from "../IconButton";
import { SourceStrip } from "../SourceStrip";
import type { SourceStripCursorReadout } from "../SourceStrip";
import type { Source } from "../../source";
import { useViewSync } from "../../sync";
import { Curtain } from "../spectral/Curtain";
import type { TransportControl } from "../spectral/Transport";
import type { AudioData } from "../spectral/types";
import { FrequencyAxis, DbAxis, TimeRuler } from "../spectral/Axes";
import { FrequencyMinimap } from "../spectral/FrequencyMinimap";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { Selection } from "../spectral/Selection";
import { useLayerOpacity } from "./layerOpacity";
import { EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";
import { eventToTime, timeToFraction } from "./viewCursor";

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
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

type GridMode = "freq" | "amp";

/**
 * Per-cell view window — initial fractions mirror OverlayView / TimelineView.
 * Interactive zoom/scroll is a future-phase wiring step.
 */
const INITIAL_VIEW_START_FRAC = 0.3;
const INITIAL_VIEW_END_FRAC = 0.5;

/** Empty sync state — no cursor / selection until the user interacts. */
const EMPTY_VIEW_SYNC = {
  cursor: null,
  selection: null,
  timeRange: { start: 0, end: 0 },
} as const;

const FFT_OPTIONS = ["1024", "2048", "4096", "8192", "16384"] as const;
const HOP_OPTIONS = ["2", "4", "8", "16", "32"] as const;
const HOP_LABELS = ["1/2", "1/4", "1/8", "1/16", "1/32"] as const;

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
 * Mini-dropdown — duplicated from OverlayView / TimelineView for the same
 * reason as `GridOverlay`. Pure presentation; trivially extractable later.
 */
function MiniDropdown({
  value,
  options,
  labels,
  onChange,
}: {
  readonly value: string;
  readonly options: ReadonlyArray<string>;
  readonly labels?: ReadonlyArray<string>;
  readonly onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const displayLabel = labels ? labels[options.indexOf(value)] ?? value : value;

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-0.5 px-1 py-0.5 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="flex items-center gap-0.5 bg-chrome-raised">
          <span>{displayLabel}</span>
          <Icon icon="lucide:chevron-down" width={10} height={10} />
        </span>
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-1 flex -translate-x-1/2 flex-col bg-chrome-raised py-1">
          {options.map((opt, index) => (
            <button
              key={opt}
              type="button"
              className={`whitespace-nowrap px-3 py-1 text-left font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] hover:bg-interactive-hover ${
                opt === value ? "text-chrome-text" : "text-chrome-text-secondary"
              }`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {labels ? labels[index] : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * SliderView — wipe-compare. Two `<SourceStrip>` instances z-stacked at full
 * opacity. The top strip's `clipPath` is `inset(0 ${(1-x)*100}% 0 0)`, masking
 * everything to the right of the handle so only its left portion is visible.
 * The bottom strip (no clip) is revealed wherever the top strip is masked
 * away. A `<Curtain>` renders the draggable vertical handle at the same X.
 *
 * Page-level chrome (grid template + TimeRuler + FrequencyAxis + DbAxis +
 * FrequencyMinimap + right-column controls + GridOverlay + Selection +
 * playhead + cursor readout chip) is identical to OverlayView and
 * TimelineView. SliderView is the third copy of this chrome — see the plan
 * Notes for the chrome-extraction candidate status now that three concrete
 * instances exist.
 *
 * First-pass judgment calls (recorded in the plan):
 *   - **>2 renderable sources**: takes the first two renderable
 *     (`renderableSources[0]` and `renderableSources[1]`). Picking which two to
 *     wipe between is a future follow-up; default behaviour is documented
 *     rather than silently clamped without a record.
 *   - **<2 renderable sources**: content cell shows a "Need at least two
 *     visible sources" message in `font-technical text-sm text-chrome-text-dim`.
 *     The rest of the page chrome stays mounted so the view remains navigable.
 *     A source is renderable when it is visible *and* has decoded audio.
 *   - **Audio-playback switching at the handle is out of scope.** The published
 *     `TransportControl` mirrors OverlayView/TimelineView — visual-only.
 *   - **Curtain reuse**: the existing `Curtain` primitive is used unchanged.
 *     Its prop shape is `{ position, onPositionChange, min?, max? }`; the
 *     `position` fraction in [0,1] is the same value we use for `handleX` and
 *     for the top strip's `clipPath` inset.
 */
export function SliderView({
  sources,
  sourceAudio,
  channelInput,
  onTransportControlChange,
}: SliderViewProps) {
  const [cursorReadout, setCursorReadout] =
    useState<SourceStripCursorReadout>(DEFAULT_CURSOR);
  const [gridMode, setGridMode] = useState<GridMode>("freq");
  const [gridOpacity, setGridOpacity] = useState(0.3);
  const [fftSize, setFftSize] = useState(2048);
  const [hopOverlap, setHopOverlap] = useState(16);
  const [viewStartFrac, setViewStartFrac] = useState(INITIAL_VIEW_START_FRAC);
  const [viewEndFrac, setViewEndFrac] = useState(INITIAL_VIEW_END_FRAC);

  // Reserved for future zoom/scroll wiring.
  void setViewStartFrac;
  void setViewEndFrac;

  const [handleX, setHandleX] = useState(0.5);

  // Cross-view sync — the inspection cursor / selection (shared when the
  // global Sync toggle is on, local otherwise).
  const viewSync = useViewSync("slider", EMPTY_VIEW_SYNC);

  // Right-column layer-opacity knob values (waveform / spectrogram / loudness).
  const layerOpacity = useLayerOpacity();

  // Visible sources that have decoded audio, paired with their `AudioData`.
  const renderableSources = useMemo(
    () => resolveVisibleSourceAudio(sources, sourceAudio),
    [sources, sourceAudio],
  );

  // Shared chrome (time ruler, minimaps, duration) sizes against the first
  // renderable source's audio; a zero-duration fallback when none.
  const chromeAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;

  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const durationSec = chromeAudio.durationMs / 1000;

  const startMs = chromeAudio.durationMs * viewStartFrac;
  const endMs = chromeAudio.durationMs * viewEndFrac;

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

  const top = renderableSources[0];
  const bottom = renderableSources[1];
  const hasPair = top !== undefined && bottom !== undefined;

  // Frequency minimap is a single-source overview. With a wipe between two
  // sources the choice is arbitrary — pick the top (visually-foreground)
  // source's color, falling back to a neutral chrome pair when no pair.
  const minimapLayerColor =
    top?.source.layerColor ?? {
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
          gridTemplateRows: "2rem minmax(0, 1fr) 3rem",
        }}
      >
        {/* Row 1: blank | ruler | blank | blank */}
        <div className="bg-void" />
        <TimeRuler startMs={startMs} endMs={endMs} />
        <div className="bg-void" />
        <div className="bg-void" />

        {/* Row 2: freq axis | content cell | freq minimap | dB axis */}
        <FrequencyAxis />

        {/* Content cell — wipe-compare. Two SourceStrips z-stacked; top is
            clip-pathed to leave only its left portion (up to handleX) visible.
            Curtain renders the draggable vertical handle. Clicking places the
            inspection cursor (sync-aware). */}
        <div
          className="relative cursor-crosshair overflow-hidden bg-void"
          onClick={handleCursorClick}
        >
          {hasPair ? (
            <>
              {/* Bottom strip — full opacity, no clip. Revealed wherever the
                  top strip is masked away. */}
              <SourceStrip
                source={bottom.source}
                audioData={bottom.audioData}
                startMs={startMs}
                endMs={endMs}
                fftSize={fftSize}
                hopOverlap={hopOverlap}
                channelInput={channelInput}
                waveformOpacity={layerOpacity.waveformOpacity}
                spectrogramOpacity={layerOpacity.spectrogramOpacity}
                onCursorMove={setCursorReadout}
              />
              {/* Top strip — clip-pathed so only the left `handleX` fraction is
                  visible. The bottom strip shows through everywhere else. */}
              <SourceStrip
                source={top.source}
                audioData={top.audioData}
                startMs={startMs}
                endMs={endMs}
                fftSize={fftSize}
                hopOverlap={hopOverlap}
                channelInput={channelInput}
                clipPath={`inset(0 ${(1 - handleX) * 100}% 0 0)`}
                waveformOpacity={layerOpacity.waveformOpacity}
                spectrogramOpacity={layerOpacity.spectrogramOpacity}
                onCursorMove={setCursorReadout}
              />
              {/* Draggable handle. Curtain reads its parent's rect for dragging,
                  so it must sit as a direct child of this `position: relative`
                  content cell. */}
              <Curtain position={handleX} onPositionChange={setHandleX} />
              {/* Shared chrome — overlays the entire content cell, above the
                  clip-pathed strips but below the Curtain handle (the Curtain
                  needs to be the last interactive element so its drag handle
                  stays on top). Currently Curtain is appended after, so its
                  pointer-events-auto handle remains clickable. */}
              <GridOverlay
                startMs={startMs}
                endMs={endMs}
                mode={gridMode}
                opacity={gridOpacity}
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
        />
        <div className="bg-void" />
        <div className="bg-void" />
      </div>

      {/* Right column — display controls. Same layout as OverlayView /
          TimelineView. */}
      <div className="flex w-16 shrink-0 flex-col items-center bg-void">
        <div className="h-8 shrink-0" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-2">
          {/* Grid opacity knob + mode toggle */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob
              value={gridOpacity}
              label=""
              size={24}
              hideValue
              onChange={setGridOpacity}
            />
            <Icon
              icon="lucide:grid-3x3"
              width={12}
              height={12}
              className="text-chrome-text-dim"
            />
          </div>
          <div className="flex flex-col items-center">
            <IconButton
              icon="lucide:music"
              label="Frequency grid"
              size={12}
              variant="ghost"
              active={gridMode === "freq"}
              onClick={() => {
                setGridMode("freq");
              }}
            />
            <IconButton
              icon="lucide:gauge"
              label="Amplitude grid"
              size={12}
              variant="ghost"
              active={gridMode === "amp"}
              onClick={() => {
                setGridMode("amp");
              }}
            />
          </div>

          <div className="my-3 w-6 border-t border-chrome-border-subtle" />

          {/* Waveform layer opacity knob — wired (matches OverlayView). */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob
              value={layerOpacity.waveformOpacity}
              label=""
              size={24}
              hideValue
              onChange={layerOpacity.setWaveformOpacity}
            />
            <Icon
              icon="lucide:audio-waveform"
              width={12}
              height={12}
              className="text-chrome-text-dim"
            />
          </div>

          <div className="my-3 w-6 border-t border-chrome-border-subtle" />

          {/* Spectrogram layer opacity knob — wired (matches OverlayView). */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob
              value={layerOpacity.spectrogramOpacity}
              label=""
              size={24}
              hideValue
              onChange={layerOpacity.setSpectrogramOpacity}
            />
            <Icon
              icon="lucide:flame"
              width={12}
              height={12}
              className="text-chrome-text-dim"
            />
          </div>

          {/* Frequency-scale stub (matches OverlayView). */}
          <button
            type="button"
            className="flex items-center gap-0.5 px-1 py-0.5 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text hover:text-chrome-text"
          >
            <span className="flex items-center gap-0.5 bg-chrome-raised">
              <span>Mel</span>
              <Icon icon="lucide:chevron-down" width={10} height={10} />
            </span>
          </button>

          <MiniDropdown
            value={String(fftSize)}
            options={FFT_OPTIONS}
            onChange={(value) => {
              setFftSize(Number(value));
            }}
          />
          <MiniDropdown
            value={String(hopOverlap)}
            options={HOP_OPTIONS}
            labels={HOP_LABELS}
            onChange={(value) => {
              setHopOverlap(Number(value));
            }}
          />

          <div className="my-1 w-6 border-t border-chrome-border-subtle" />

          {/* Loudness layer opacity knob — controlled but unconsumed; the
              strip has no loudness layer (matches OverlayView). */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob
              value={layerOpacity.loudnessOpacity}
              label=""
              size={24}
              hideValue
              onChange={layerOpacity.setLoudnessOpacity}
            />
            <Icon
              icon="lucide:activity"
              width={12}
              height={12}
              className="text-chrome-text-dim"
            />
          </div>
        </div>
        <div className="h-10 shrink-0" />
      </div>
    </div>
  );
}
