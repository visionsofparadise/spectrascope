import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Knob } from "../controls/Knob";
import { IconButton } from "../IconButton";
import { SourceStrip } from "../SourceStrip";
import type { SourceStripCursorReadout } from "../SourceStrip";
import type { Source } from "../../source";
import type { TransportControl } from "../spectral/Transport";
import type { AudioData } from "../spectral/types";
import { FrequencyAxis, DbAxis, TimeRuler } from "../spectral/Axes";
import { FrequencyMinimap } from "../spectral/FrequencyMinimap";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { Selection } from "../spectral/Selection";

/**
 * Local `#RRGGBB` → `[r, g, b]` helper. Duplicates SourceStrip's hexToRgb255
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
  readonly audioData: AudioData;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

type GridMode = "freq" | "amp";

/**
 * Per-cell view window — initial fractions mirror SpectralPage's hardcoded
 * preview window. Zoom and scroll are not interactive yet; this view holds
 * the window in state so subsequent phases can wire interaction here without
 * shape changes. Documented as a Phase 4 deferral.
 */
const INITIAL_VIEW_START_FRAC = 0.3;
const INITIAL_VIEW_END_FRAC = 0.5;

/**
 * Placeholder selection and cursor fractions — same values SpectralPage used.
 * Real interactive selection + playhead-driven cursor are Phase 4 deferrals.
 */
const SELECTION_START_FRAC = 0.25;
const SELECTION_END_FRAC = 0.45;
const CURSOR_FRAC = 0.38;

const FFT_OPTIONS = ["1024", "2048", "4096", "8192", "16384"] as const;
const HOP_OPTIONS = ["2", "4", "8", "16", "32"] as const;
const HOP_LABELS = ["1/2", "1/4", "1/8", "1/16", "1/32"] as const;

const DEFAULT_CURSOR: SourceStripCursorReadout = {
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
 * Mini-dropdown — small inline value-list dropdown used in the right-column
 * display controls (FFT size, hop overlap). Ported from SpectralPage reference
 * (`archive/spectralpage-reference.tsx` lines ~85-122).
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
 * OverlayView — every visible source's `SourceStrip` z-stacked in the same
 * viewport, blended via `mix-blend-mode: lighten`. The documented exception
 * to the no-opacity-for-data rule: for this view, the blend mode *is* the
 * data composition.
 *
 * Structural template: ported from the pre-deletion SpectralPage's
 * `SpectralPage` function (`archive/spectralpage-reference.tsx` lines ~327-575).
 * Keeps the SpectralPage grid layout, right-column display controls, and
 * frequency minimap. The **content cell** (row 2 col 2) is now N stacked
 * `<SourceStrip>` instances inside a `mix-blend-mode: lighten` wrapper, plus a
 * single shared `<GridOverlay>` + `<Selection>` + playhead cursor line owned
 * by the view.
 *
 * Phase 4 deferrals (recorded in the workspace-shell plan Notes):
 * - The DemoTabBar / top-bar / source-pickers / A-B knobs / node-nav from the
 *   SpectralPage reference are gone — the workspace ViewTabs strip replaces
 *   them, and the Sources Panel handles per-source picking.
 * - The stereo meter from the SpectralPage right column is gone — it didn't
 *   generalize across N sources; pending follow-up.
 * - Cursor readout (`time/freq/amp`) is held as local state and shown as an
 *   unobtrusive overlay in the bottom-left of the content cell. The Phase 1
 *   stripped Transport doesn't render readouts; wiring readouts back into
 *   Transport is deferred.
 * - The view window (`startMs/endMs`), selection range, and playhead cursor
 *   are held in state with placeholder fractions (matching SpectralPage's
 *   hardcoded preview). Interactive zoom/scroll/seek is future work.
 * - All sources share the same `audioData` buffer in first pass — per-source
 *   distinct audio is a follow-up phase.
 *
 * Audibility rule (solo overrides mute) is computed for downstream audio
 * pipeline consumption; the visual stack uses `visible === true` only.
 */
export function OverlayView({
  sources,
  audioData,
  onTransportControlChange,
}: OverlayViewProps) {
  const [cursorReadout, setCursorReadout] =
    useState<SourceStripCursorReadout>(DEFAULT_CURSOR);
  const [gridMode, setGridMode] = useState<GridMode>("freq");
  const [gridOpacity, setGridOpacity] = useState(0.3);
  const [fftSize, setFftSize] = useState(2048);
  const [hopOverlap, setHopOverlap] = useState(16);
  const [viewStartFrac, setViewStartFrac] = useState(INITIAL_VIEW_START_FRAC);
  const [viewEndFrac, setViewEndFrac] = useState(INITIAL_VIEW_END_FRAC);

  // Reserved for future zoom/scroll wiring — the setters are not yet bound to
  // any interaction. Silence the unused-setter lint without dropping the API
  // surface.
  void setViewStartFrac;
  void setViewEndFrac;

  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const durationSec = audioData.durationMs / 1000;

  const startMs = audioData.durationMs * viewStartFrac;
  const endMs = audioData.durationMs * viewEndFrac;

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

  const onPlayToggle = useCallback(() => {
    setPlaying((prev) => !prev);
  }, []);

  const onSeek = useCallback(
    (sec: number) => {
      setPositionSec(Math.max(0, Math.min(durationSec, sec)));
    },
    [durationSec],
  );

  const transportControl = useMemo<TransportControl>(
    () => ({
      playing,
      positionSec,
      durationSec,
      onPlayToggle,
      onSeek,
      cursorReadout,
      // Demo selection range — surfaces as the transport's In / Out columns.
      // Matches the placeholder <Selection> overlay drawn in the content cell.
      selectionInSec: durationSec * SELECTION_START_FRAC,
      selectionOutSec: durationSec * SELECTION_END_FRAC,
      selectionInAmp: "-19.7 dB",
      selectionOutAmp: "-24.3 dB",
    }),
    [playing, positionSec, durationSec, onPlayToggle, onSeek, cursorReadout],
  );

  useEffect(() => {
    if (onTransportControlChange) {
      onTransportControlChange(transportControl);
    }
  }, [onTransportControlChange, transportControl]);

  // Use the first visible source's color for the frequency minimap (it's a
  // single-source overview; with N sources the choice is arbitrary — pick the
  // first stable visible).
  const minimapLayerColor =
    visibleSources[0]?.layerColor ?? {
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

        {/* Content cell — N stacked SourceStrips + shared view chrome. */}
        <div className="relative overflow-hidden bg-void">
          {visibleSources.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-body text-sm text-chrome-text-secondary">
                No visible sources.
              </p>
            </div>
          ) : (
            <>
              <div
                className="absolute inset-0"
                style={{ mixBlendMode: "lighten" }}
              >
                {visibleSources.map((source) => (
                  <SourceStrip
                    key={source.id}
                    source={source}
                    audioData={audioData}
                    startMs={startMs}
                    endMs={endMs}
                    fftSize={fftSize}
                    hopOverlap={hopOverlap}
                    opacity={0.5}
                    onCursorMove={setCursorReadout}
                  />
                ))}
              </div>
              <GridOverlay
                startMs={startMs}
                endMs={endMs}
                mode={gridMode}
                opacity={gridOpacity}
              />
              <Selection
                startFraction={SELECTION_START_FRAC}
                endFraction={SELECTION_END_FRAC}
              />
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-data-cursor"
                style={{ left: `${CURSOR_FRAC * 100}%` }}
              />
              {/* The time / freq / amp cursor readout is published up to the
                  Transport (see `transportControl.cursorReadout`); the view
                  itself draws no in-pane readout chip. */}
            </>
          )}
        </div>

        <FrequencyMinimap
          audioData={audioData}
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
          audioData={audioData}
          viewStartFrac={viewStartFrac}
          viewEndFrac={viewEndFrac}
          waveformColor={hexToRgb255(minimapLayerColor.primary)}
        />
        <div className="bg-void" />
        <div className="bg-void" />
      </div>

      {/* Right column — display controls. Ported from SpectralPage reference
          (lines ~496-568) minus the stereo meter (dropped — doesn't
          generalize across N sources). */}
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

          {/* Waveform layer opacity knob. Visual stub — no onChange/state yet;
              real wiring of per-layer opacity is future work. Matches the
              SpectralPage reference (lines ~519-523). */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob value={0.8} label="" size={24} hideValue />
            <Icon
              icon="lucide:audio-waveform"
              width={12}
              height={12}
              className="text-chrome-text-dim"
            />
          </div>

          <div className="my-3 w-6 border-t border-chrome-border-subtle" />

          {/* Spectrogram layer opacity knob. Visual stub — no onChange/state
              yet; real wiring of per-layer opacity is future work. Matches the
              SpectralPage reference (lines ~526-530). */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob value={0.7} label="" size={24} hideValue />
            <Icon
              icon="lucide:flame"
              width={12}
              height={12}
              className="text-chrome-text-dim"
            />
          </div>

          {/* Frequency-scale dropdown stub. Visual stub — non-functional
              button rendered to preserve the chrome contract; real
              scale-switching wiring is future work. Matches the SpectralPage
              reference (lines ~532-540). */}
          <button
            type="button"
            className="flex items-center gap-0.5 px-1 py-0.5 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text hover:text-chrome-text"
          >
            <span className="flex items-center gap-0.5 bg-chrome-raised">
              <span>Mel</span>
              <Icon icon="lucide:chevron-down" width={10} height={10} />
            </span>
          </button>

          {/* FFT size */}
          <MiniDropdown
            value={String(fftSize)}
            options={FFT_OPTIONS}
            onChange={(value) => {
              setFftSize(Number(value));
            }}
          />
          {/* Hop overlap */}
          <MiniDropdown
            value={String(hopOverlap)}
            options={HOP_OPTIONS}
            labels={HOP_LABELS}
            onChange={(value) => {
              setHopOverlap(Number(value));
            }}
          />

          <div className="my-1 w-6 border-t border-chrome-border-subtle" />

          {/* Loudness layer opacity knob. Visual stub — no onChange/state yet;
              real wiring of per-layer opacity is future work. Matches the
              SpectralPage reference (lines ~560-564). */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob value={0.5} label="" size={24} hideValue />
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
