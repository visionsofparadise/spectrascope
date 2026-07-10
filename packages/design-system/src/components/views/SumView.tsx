// SumView renders a single `SourceStrip` against the `derivedAudio` prop — the
// summed signal. Phase 3 routes a placeholder `derivedAudio` (the first
// source's buffer); Phase 5 populates it with the ffmpeg-rendered Sum temp
// file. The summed strip carries a fixed neutral `layerColor` so it reads as
// belonging to no individual source.

import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChannelInput } from "spectral-display";
import { Knob } from "../controls/Knob";
import { IconButton } from "../IconButton";
import { SourceStrip } from "../SourceStrip";
import type { SourceStripCursorReadout } from "../SourceStrip";
import type { Source } from "../../source";
import type { LayerColor } from "../../layers";
import { useViewSync } from "../../sync";
import type { TransportControl } from "../spectral/Transport";
import type { AudioData } from "../spectral/types";
import { FrequencyAxis, DbAxis, TimeRuler } from "../spectral/Axes";
import { FrequencyMinimap } from "../spectral/FrequencyMinimap";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { Selection } from "../spectral/Selection";
import { useLayerOpacity } from "./layerOpacity";
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

interface SumViewProps {
  readonly sources: ReadonlyArray<Source>;
  /**
   * The derived (summed) signal as a single PCM reader. Phase 5 populates this
   * with the ffmpeg-rendered Sum temp file; Phase 3 routes a placeholder.
   */
  readonly derivedAudio: AudioData;
  /** The global Mono/Mid/Side channel-input mode — passed to the strip. */
  readonly channelInput: ChannelInput;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

type GridMode = "freq" | "amp";

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
 * Neutral chrome pair for the summed pseudo-source. The sum belongs to no
 * single source, so its `layerColor` is fixed rather than derived from any
 * one input. `#A3E635` (lime-400) + `#440154` (viridis dark violet) gives a
 * strong yet not-source-collisioned anchor against the demo's default
 * palette. Documented in the plan Notes as the chosen neutral.
 */
const SUM_LAYER_COLOR: LayerColor = {
  primary: "#A3E635",
  secondary: "#440154",
};

/**
 * Inline `GridOverlay` — same body as OverlayView / TimelineView / SliderView
 * / DifferenceView. SumView is the fifth copy. Chrome extraction is now a
 * strong candidate; deferred per the plan Notes for Phase 7.
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
 * Mini-dropdown — duplicated from the other per-source views.
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
 * SumView — one full-pane `<SourceStrip>` rendering a "sum" pseudo-source
 * against the `derivedAudio` prop. Phase 5 feeds `derivedAudio` the
 * ffmpeg-rendered Sum temp file; this phase routes a placeholder. The strip
 * carries a neutral `layerColor` (lime + viridis-dark) so it reads as distinct
 * from any individual source.
 *
 * Page-level chrome (grid template + TimeRuler + FrequencyAxis + DbAxis +
 * FrequencyMinimap + right-column controls + GridOverlay + Selection +
 * playhead + cursor readout chip) is identical to the other per-source
 * views. The **content cell** is one full-pane `<SourceStrip>` (mirroring
 * OverlayView's single-source case, but with no blend-mode wrapper since
 * there is only one strip).
 *
 * First-pass judgment calls (recorded in the plan):
 *   - **0 visible sources**: content cell shows a "No visible sources"
 *     message in `font-technical text-sm text-chrome-text-dim`. The rest of
 *     the page chrome stays mounted so the view remains navigable. Matches
 *     the empty-state convention used by OverlayView.
 *   - **Pseudo-source synthesis**: a single synthesised `Source` with
 *     `id = "sum"`, `name = "Σ all sources"` (U+03A3 GREEK CAPITAL LETTER
 *     SIGMA), `audioFilePath = "derived"`, `layerColor = SUM_LAYER_COLOR`, and
 *     default flags (`visible: true, muted: false, soloed: false`).
 *   - **Neutral color choice**: lime-400 + viridis-dark-violet. Picked
 *     because the sum belongs to no single source — anchoring it to one of
 *     the input colors would lie about the data's provenance. The lime/
 *     viridis pair reads as a "different family" from the default palette.
 *   - **TransportControl publish**: matches the other per-source views.
 */
export function SumView({
  sources,
  derivedAudio,
  channelInput,
  onTransportControlChange,
}: SumViewProps) {
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

  // Cross-view sync — the inspection cursor / selection (shared when the
  // global Sync toggle is on, local otherwise).
  const viewSync = useViewSync("sum", EMPTY_VIEW_SYNC);

  // Right-column layer-opacity knob values (waveform / spectrogram / loudness).
  const layerOpacity = useLayerOpacity();

  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const durationSec = derivedAudio.durationMs / 1000;

  const startMs = derivedAudio.durationMs * viewStartFrac;
  const endMs = derivedAudio.durationMs * viewEndFrac;

  const visibleSources = useMemo(
    () => sources.filter((source) => source.visible),
    [sources],
  );

  // Audibility — solo overrides mute. Reserved for future audio-pipeline
  // wiring; the visual stack uses `visible === true` only.
  const anySoloed = sources.some((source) => source.soloed);
  const audibleSources = anySoloed
    ? sources.filter((source) => source.soloed)
    : sources.filter((source) => !source.muted && source.visible);

  void audibleSources;

  /**
   * Build the synthesised "sum" pseudo-source. The strip is rendered against
   * the `derivedAudio` reader; the pseudo-source carries the neutral
   * `SUM_LAYER_COLOR` so the rendered strip reads as not-belonging-to any
   * individual source.
   */
  const sumSource = useMemo<Source>(
    () => ({
      id: "sum",
      name: "Σ all sources",
      audioFilePath: "derived",
      timelineOffsetMs: 0,
      layerColor: SUM_LAYER_COLOR,
      visible: true,
      muted: false,
      soloed: false,
    }),
    [],
  );

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

  // Frequency minimap — for the sum view, the strip's own (neutral) color is
  // the natural choice. Matches the visual anchor of the content cell.
  const minimapLayerColor = SUM_LAYER_COLOR;

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

        {/* Content cell — one full-pane SourceStrip of the sum pseudo-source.
            No blend-mode wrapper (single strip); the strip's `absolute inset-0`
            positioning fills the cell. Clicking places the inspection cursor
            (sync-aware). */}
        <div
          className="relative cursor-crosshair overflow-hidden bg-void"
          onClick={handleCursorClick}
        >
          {visibleSources.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-technical text-sm text-chrome-text-dim">
                No visible sources
              </p>
            </div>
          ) : (
            <>
              <SourceStrip
                source={sumSource}
                audioData={derivedAudio}
                startMs={startMs}
                endMs={endMs}
                fftSize={fftSize}
                hopOverlap={hopOverlap}
                channelInput={channelInput}
                waveformOpacity={layerOpacity.waveformOpacity}
                spectrogramOpacity={layerOpacity.spectrogramOpacity}
                onCursorMove={setCursorReadout}
              />
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
          )}
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

      {/* Right column — display controls. Same layout as the other
          per-source views. */}
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
