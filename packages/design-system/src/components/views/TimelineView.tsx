import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Knob } from "../controls/Knob";
import { SourceStrip } from "../SourceStrip";
import type { SourceStripCursorReadout } from "../SourceStrip";
import type { Source } from "../../source";
import type { TransportControl } from "../spectral/Transport";
import type { AudioData } from "../spectral/types";
import { TimeRuler } from "../spectral/Axes";
import { MinimapDisplay } from "../spectral/MinimapDisplay";

const DEFAULT_CURSOR: SourceStripCursorReadout = {
  time: "00:00.000",
  freq: "— Hz",
  amp: "— dB",
};

/** Local `#RRGGBB` → `[r, g, b]` helper. Duplicates the per-view copies in
 *  OverlayView / SliderView / DifferenceView / SumView. */
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

const FFT_OPTIONS = ["1024", "2048", "4096", "8192", "16384"] as const;
const HOP_OPTIONS = ["2", "4", "8", "16", "32"] as const;
const HOP_LABELS = ["1/2", "1/4", "1/8", "1/16", "1/32"] as const;

/**
 * Inline `GridOverlay` — the vertical time-tick grid. The OverlayView /
 * SliderView / DifferenceView / SumView copies also draw horizontal
 * frequency/amplitude lines; TimelineView has no frequency or amplitude axis,
 * so it draws time lines only.
 */
function GridOverlay({
  startMs,
  endMs,
  opacity,
}: {
  readonly startMs: number;
  readonly endMs: number;
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

  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity }}>
      {timeTicks.map((frac) => (
        <div
          key={`t${frac}`}
          className="absolute top-0 bottom-0 w-px bg-chrome-text"
          style={{ left: `${frac * 100}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Mini-dropdown — duplicated from OverlayView for the right-column FFT-size and
 * hop-overlap controls. Pure presentation; trivially extractable later.
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

interface TimelineViewProps {
  readonly sources: ReadonlyArray<Source>;
  readonly audioData: AudioData;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

/**
 * TimelineView — DAW-style multi-track timeline. Layout:
 *   - A main grid: horizontal `TimeRuler` (top), N equal-flex `SourceStrip`
 *     track rows with a per-track `GridOverlay` and a single full-height
 *     vertical playhead, and a horizontal overview `MinimapDisplay` (bottom).
 *   - A right-hand display-controls column — a trimmed copy of OverlayView's:
 *     grid opacity, layer-opacity knobs, FFT size, hop overlap.
 *
 * No frequency axis, no dB axis, no frequency minimap, no selection, no cursor
 * readout chip — those stay Overlay/Slider concerns. The per-track grid is
 * time-only (vertical lines aligned to the `TimeRuler`); the strips carry no
 * frequency or amplitude axis to draw horizontal lines against.
 *
 * Each strip renders the full duration (`0 → audioData.durationMs`); there is
 * no per-view zoom window. Transport playback drives `positionSec`, and the
 * playhead is positioned at `positionSec / durationSec` (clamped to [0, 1]).
 *
 * Visible-source filtering and audibility (solo overrides mute) match the
 * other per-source views so the DAW grammar carries through.
 */
export function TimelineView({
  sources,
  audioData,
  onTransportControlChange,
}: TimelineViewProps) {
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [cursorReadout, setCursorReadout] =
    useState<SourceStripCursorReadout>(DEFAULT_CURSOR);
  const [gridOpacity, setGridOpacity] = useState(0.3);
  const [fftSize, setFftSize] = useState(2048);
  const [hopOverlap, setHopOverlap] = useState(16);
  const durationSec = audioData.durationMs / 1000;

  const visibleSources = useMemo(
    () => sources.filter((source) => source.visible),
    [sources],
  );

  // The horizontal overview minimap renders a single waveform; with N tracks
  // the colour choice is arbitrary, so use the first visible source's primary
  // (a neutral chrome pair when nothing is visible).
  const minimapColor = visibleSources[0]?.layerColor ?? {
    primary: "#B8B8C0",
    secondary: "#44444C",
  };

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

  const playheadFrac =
    durationSec > 0 ? Math.max(0, Math.min(1, positionSec / durationSec)) : 0;

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-void">
      {/* Main grid — time ruler, track stack, overview minimap. */}
      <div
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gridTemplateRows: "auto minmax(0, 1fr) auto",
        }}
      >
        {/* Row 1 — full-duration time ruler. */}
        <TimeRuler startMs={0} endMs={audioData.durationMs} />

        {/* Row 2 — track stack + playhead. */}
        <div className="relative flex flex-col overflow-hidden bg-void">
          {visibleSources.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-body text-sm text-chrome-text-secondary">
                No visible sources.
              </p>
            </div>
          ) : (
            <>
              {visibleSources.map((source) => (
                <div key={source.id} className="relative min-h-0 flex-1">
                  <SourceStrip
                    source={source}
                    audioData={audioData}
                    startMs={0}
                    endMs={audioData.durationMs}
                    fftSize={fftSize}
                    hopOverlap={hopOverlap}
                    onCursorMove={setCursorReadout}
                  />
                  {/* Per-track grid — drawn inside each strip so its
                      frequency lines map to that strip's own axis. */}
                  <GridOverlay
                    startMs={0}
                    endMs={audioData.durationMs}
                    opacity={gridOpacity}
                  />
                </div>
              ))}
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-data-cursor"
                style={{ left: `${playheadFrac * 100}%` }}
              />
            </>
          )}
        </div>

        {/* Row 3 — horizontal overview minimap across the full duration. */}
        <MinimapDisplay
          audioData={audioData}
          viewStartFrac={0}
          viewEndFrac={1}
          waveformColor={hexToRgb255(minimapColor.primary)}
        />
      </div>

      {/* Right column — display controls. A trimmed copy of OverlayView's:
          grid opacity, layer-opacity knobs (visual stubs), frequency scale
          (stub), FFT size, hop overlap. */}
      <div className="flex w-16 shrink-0 flex-col items-center bg-void">
        <div className="h-8 shrink-0" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-2">
          {/* Grid opacity knob — drives the per-track time-line grid. */}
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

          <div className="my-3 w-6 border-t border-chrome-border-subtle" />

          {/* Waveform layer opacity knob — visual stub, matches OverlayView. */}
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

          {/* Spectrogram layer opacity knob — visual stub, matches OverlayView. */}
          <div className="flex flex-col items-center gap-0.5">
            <Knob value={0.7} label="" size={24} hideValue />
            <Icon
              icon="lucide:flame"
              width={12}
              height={12}
              className="text-chrome-text-dim"
            />
          </div>

          {/* Frequency-scale dropdown stub — matches OverlayView. */}
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

          {/* Loudness layer opacity knob — visual stub, matches OverlayView. */}
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
