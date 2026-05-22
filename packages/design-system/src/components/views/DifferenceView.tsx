// Placeholder synthetic data — real signal synthesis is out of first-pass scope.
// Each derived strip renders against the SAME demo `audioData` as the inputs;
// visual differentiation comes from the pseudo-source's `layerColor` only.
// Wiring a real difference signal (A−B PCM arithmetic against AudioContext
// buffers) is a follow-up plan.

import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Knob } from "../controls/Knob";
import { IconButton } from "../IconButton";
import { SourceStrip } from "../SourceStrip";
import type { SourceStripCursorReadout } from "../SourceStrip";
import type { Source } from "../../source";
import type { LayerColor } from "../../layers";
import type { TransportControl } from "../spectral/Transport";
import type { AudioData } from "../spectral/types";
import { FrequencyAxis, DbAxis, TimeRuler } from "../spectral/Axes";
import { FrequencyMinimap } from "../spectral/FrequencyMinimap";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { Selection } from "../spectral/Selection";

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
  readonly audioData: AudioData;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

type GridMode = "freq" | "amp";

/**
 * Per-cell view window — initial fractions mirror OverlayView / TimelineView /
 * SliderView. Interactive zoom/scroll is a future-phase wiring step.
 */
const INITIAL_VIEW_START_FRAC = 0.3;
const INITIAL_VIEW_END_FRAC = 0.5;

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
 * Mini-dropdown — duplicated from OverlayView / TimelineView / SliderView for
 * the same reason as `GridOverlay`. Pure-presentation; trivially extractable
 * later.
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
 * DifferenceView — single full-pane `<SourceStrip>` rendering a synthesised
 * "difference" pseudo-source. The pseudo-source borrows the first visible
 * source's `layerColor` (or a neutral chrome fallback when no sources are
 * visible). Real PCM arithmetic is out of scope; the strip currently renders
 * against the shared demo `audioData`.
 *
 * Page-level chrome (grid template + TimeRuler + FrequencyAxis + DbAxis +
 * FrequencyMinimap + right-column controls + GridOverlay + Selection +
 * playhead + cursor readout chip) is unchanged.
 */
const DIFFERENCE_NEUTRAL_COLOR: LayerColor = {
  primary: "#B8B8C0",
  secondary: "#44444C",
};

export function DifferenceView({
  sources,
  audioData,
  onTransportControlChange,
}: DifferenceViewProps) {
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

  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const durationSec = audioData.durationMs / 1000;

  const startMs = audioData.durationMs * viewStartFrac;
  const endMs = audioData.durationMs * viewEndFrac;

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
      filePath: "derived",
      layerColor: anchorColor,
      visible: true,
      muted: false,
      soloed: false,
      gainDb: 0,
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

  const transportControl = useMemo<TransportControl>(
    () => ({
      playing,
      positionSec,
      durationSec,
      onPlayToggle,
      onSeek,
      cursorReadout,
      // Demo selection range (0.25–0.45 of duration) — surfaces as the
      // transport's In / Out columns.
      selectionInSec: durationSec * 0.25,
      selectionOutSec: durationSec * 0.45,
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

  // Frequency minimap mirrors the strip's color anchor.
  const minimapLayerColor = differenceSource.layerColor;

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

        {/* Content cell — one full-pane SourceStrip of the difference
            pseudo-source. */}
        <div
          className="relative overflow-hidden bg-void"
          onMouseMove={(ev) => {
            void ev;
          }}
        >
          <SourceStrip
            source={differenceSource}
            audioData={audioData}
            startMs={startMs}
            endMs={endMs}
            fftSize={fftSize}
            hopOverlap={hopOverlap}
            onCursorMove={setCursorReadout}
          />
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
          {/* The cursor readout is published up to the Transport (see
              `transportControl.cursorReadout`); no in-pane readout chip. */}
        </div>

        <FrequencyMinimap
          audioData={audioData}
          startMs={startMs}
          endMs={endMs}
          layerColor={minimapLayerColor}
        />
        <DbAxis />

        {/* Row 3: blank | horizontal MinimapDisplay | blank | blank. Pairs
            with the vertical FrequencyMinimap to give a 2D zoom/pan overview. */}
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

      {/* Right column — display controls. Same layout as the other per-source
          views. */}
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

          {/* Waveform layer opacity stub (matches OverlayView). */}
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

          {/* Spectrogram layer opacity stub (matches OverlayView). */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob value={0.7} label="" size={24} hideValue />
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

          {/* Loudness layer opacity stub (matches OverlayView). */}
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
