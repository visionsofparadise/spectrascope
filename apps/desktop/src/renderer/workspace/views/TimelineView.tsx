import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChannelInput } from "spectral-display";
import { SourceStrip } from "../SourceStrip";
import type { SourceStripCursorReadout } from "../SourceStrip";
import type { Source } from "../source";
import type { TransportControl } from "../Transport";
import type { AudioData } from "../spectral/types";
import type { ViewControlSettings } from "../viewSettings";
import { TimeRuler } from "../spectral/Axes";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";

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
 * One DAW-style track row — a `SourceStrip` placed on the shared comparison
 * timeline at its `timelineOffsetMs`, draggable horizontally to re-place it.
 *
 * Purely presentational + interactive: the row reports a *new* offset out via
 * `onOffsetChange` and never owns the persisted `timelineOffsetMs` itself. The
 * incoming `offsetMs` prop is the source of truth between drags; a `dragOffsetMs`
 * local state holds the live position only for the duration of one drag gesture
 * (so the strip tracks the pointer without waiting for a prop round-trip), and
 * is cleared the moment the parent's prop catches up.
 *
 * Drag math is plain pointer events against the track's own rect — a horizontal
 * drag is simple enough that a gesture library would be overkill (and none is in
 * the design-system's dependencies). During a drag, only the transient
 * `dragOffsetMs` visual state tracks the pointer; `onOffsetChange` is called
 * exactly once, on pointer-up, with the final offset (clamped to
 * `[0, maxOffsetMs]`) — one mutation per completed gesture, so the consumer's
 * store and any undo history get a single entry per drag. Arrow-key nudges
 * commit per keypress (each keypress is a discrete intentional edit).
 */
function TimelineTrack({
  source,
  audioData,
  offsetMs,
  timelineSpanMs,
  fftSize,
  hopOverlap,
  channelInput,
  gridOpacity,
  waveformOpacity,
  spectrogramOpacity,
  draggable,
  onCursorMove,
  onOffsetChange,
}: {
  readonly source: Source;
  readonly audioData: AudioData;
  /** This source's placement on the shared timeline, in ms (≥ 0). */
  readonly offsetMs: number;
  /** Total timeline span the row is laid out against, in ms (> 0). */
  readonly timelineSpanMs: number;
  readonly fftSize: number;
  readonly hopOverlap: number;
  readonly channelInput: ChannelInput;
  readonly gridOpacity: number;
  /** Per-layer opacity for the clip's `SourceStrip` (from shared settings). */
  readonly waveformOpacity: number;
  readonly spectrogramOpacity: number;
  /** Whether the clip can be dragged — false when no offset callback is wired. */
  readonly draggable: boolean;
  readonly onCursorMove: (readout: SourceStripCursorReadout) => void;
  /** Emits the final (clamped) offset for this source — once per completed
   *  drag (on pointer-up) and once per arrow-key nudge. */
  readonly onOffsetChange: (offsetMs: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  // Live offset for the duration of a drag gesture only — `null` when not
  // dragging, in which case the `offsetMs` prop is authoritative.
  const [dragOffsetMs, setDragOffsetMs] = useState<number | null>(null);

  const durationMs = audioData.durationMs;
  // The clip cannot start so late that it would extend past the timeline end.
  // The span carries a headroom pad (the longest source's duration) so this
  // bound is always positive for a renderable clip — every clip is draggable.
  const maxOffsetMs = Math.max(0, timelineSpanMs - durationMs);
  const effectiveOffsetMs = dragOffsetMs ?? offsetMs;

  // Latest values captured for the global pointer listeners (drag gesture).
  const onOffsetChangeRef = useRef(onOffsetChange);
  const maxOffsetRef = useRef(maxOffsetMs);
  const spanRef = useRef(timelineSpanMs);

  useEffect(() => {
    onOffsetChangeRef.current = onOffsetChange;
  }, [onOffsetChange]);
  useEffect(() => {
    maxOffsetRef.current = maxOffsetMs;
  }, [maxOffsetMs]);
  useEffect(() => {
    spanRef.current = timelineSpanMs;
  }, [timelineSpanMs]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggable) return;

      event.preventDefault();
      event.stopPropagation();

      const track = trackRef.current;

      if (!track) return;

      const rect = track.getBoundingClientRect();

      if (rect.width <= 0) return;

      // Pointer offset within the clip at grab time, in ms — keeps the grab
      // point under the cursor for the whole drag (no jump-to-pointer).
      const grabFracInTrack = (event.clientX - rect.left) / rect.width;
      const grabMs = grabFracInTrack * spanRef.current;
      const grabWithinClipMs = grabMs - effectiveOffsetMs;

      // Resolve a clamped offset from a pointer x-coordinate. Pure — does not
      // touch state or emit; the callers decide what to do with the result.
      const offsetFromClientX = (clientX: number) => {
        const lo = 0;
        const hi = maxOffsetRef.current;
        const pointerMs =
          ((clientX - rect.left) / rect.width) * spanRef.current;

        return Math.min(hi, Math.max(lo, pointerMs - grabWithinClipMs));
      };

      const onMove = (moveEvent: PointerEvent) => {
        // During the drag, update only the transient visual state so the strip
        // tracks the pointer smoothly — no `onOffsetChange` here. Emitting per
        // `pointermove` would thrash the consumer's store/disk and flood the
        // undo/redo history with one entry per move event.
        setDragOffsetMs(offsetFromClientX(moveEvent.clientX));
      };

      const onUp = (upEvent: PointerEvent) => {
        const finalOffsetMs = offsetFromClientX(upEvent.clientX);

        // Commit exactly once, at drag-end — one state mutation (and one
        // undo/redo entry) per completed drag gesture.
        onOffsetChangeRef.current(finalOffsetMs);
        // Hand control back to the `offsetMs` prop; the consumer's mutation has
        // been emitted, so the prop will arrive with the committed value.
        setDragOffsetMs(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [draggable, effectiveOffsetMs],
  );

  // Keyboard nudge — arrow keys move the clip by a coarse/fine step so the
  // affordance is operable without a pointer.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!draggable) return;

      const fine = event.shiftKey ? 10 : 100;
      let next: number | null = null;

      if (event.key === "ArrowLeft") next = offsetMs - fine;
      else if (event.key === "ArrowRight") next = offsetMs + fine;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = maxOffsetMs;

      if (next === null) return;

      event.preventDefault();
      onOffsetChange(Math.min(maxOffsetMs, Math.max(0, next)));
    },
    [draggable, offsetMs, maxOffsetMs, onOffsetChange],
  );

  const span = timelineSpanMs > 0 ? timelineSpanMs : 1;
  const leftPct = (effectiveOffsetMs / span) * 100;
  const widthPct = (durationMs / span) * 100;
  const dragging = dragOffsetMs !== null;

  return (
    <div ref={trackRef} className="relative min-h-0 flex-1 overflow-hidden">
      {/* The clip — a `SourceStrip` positioned on the shared timeline. The
          strip itself still renders its source's full content (0 → duration);
          placement is this wrapper's left/width. */}
      <div
        className="absolute inset-y-0"
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      >
        <SourceStrip
          source={source}
          audioData={audioData}
          startMs={0}
          endMs={durationMs}
          fftSize={fftSize}
          hopOverlap={hopOverlap}
          channelInput={channelInput}
          waveformOpacity={waveformOpacity}
          spectrogramOpacity={spectrogramOpacity}
          onCursorMove={onCursorMove}
        />
        {/* Per-clip time grid — drawn over this clip's own content span. */}
        <GridOverlay startMs={0} endMs={durationMs} opacity={gridOpacity} />
        {/* A thin leading edge marks the clip's start on the timeline. While
            dragging it brightens to the primary accent. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 left-0 w-0.5 ${
            dragging ? "bg-primary" : "bg-chrome-text/60"
          }`}
        />
        {/* Drag handle — a DAW-style clip header strip across the top of the
            clip. The whole header is the grab target; the grip dots make the
            draggable affordance read. Hidden entirely when no offset callback
            is wired (the demo), so the view stays a pure display there. */}
        {draggable && (
          <button
            type="button"
            onPointerDown={handlePointerDown}
            onKeyDown={handleKeyDown}
            aria-label={`Timeline offset for ${source.name}`}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={Math.round(maxOffsetMs)}
            aria-valuenow={Math.round(effectiveOffsetMs)}
            aria-valuetext={`${(effectiveOffsetMs / 1000).toFixed(2)} seconds`}
            className={`absolute top-0 left-0 right-0 flex h-4 cursor-ew-resize items-center gap-1 px-1.5 outline-none focus-visible:ring-1 focus-visible:ring-primary ${
              dragging
                ? "bg-primary/30"
                : "bg-chrome-raised/70 hover:bg-chrome-raised"
            }`}
          >
            <span aria-hidden className="flex items-center gap-0.5">
              <span className="block h-2 w-px bg-chrome-text/70" />
              <span className="block h-2 w-px bg-chrome-text/70" />
              <span className="block h-2 w-px bg-chrome-text/70" />
            </span>
            <span className="truncate font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
              {source.name}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

interface TimelineViewProps {
  readonly sources: ReadonlyArray<Source>;
  /** Per-source PCM readers, keyed by `Source.id`. */
  readonly sourceAudio: ReadonlyMap<string, AudioData>;
  /** The global Mono/Mid/Side channel-input mode — passed to every strip. */
  readonly channelInput: ChannelInput;
  /** Shared display-control settings, owned by the comparison host. */
  readonly settings: ViewControlSettings;
  /**
   * Emitted when a source's clip is dragged (or keyboard-nudged) on the
   * timeline — `(sourceId, offsetMs)` with `offsetMs ≥ 0`. Controlled,
   * props-in / callbacks-out: the view owns no placement state, it renders
   * position from each `Source.timelineOffsetMs` and reports drag results out.
   * When omitted, the timeline still lays strips out by offset but the drag
   * affordance is not rendered (the component-showcase case).
   */
  readonly onSourceOffsetChange?: (sourceId: string, offsetMs: number) => void;
  readonly onTransportControlChange?: (control: TransportControl) => void;
}

/**
 * TimelineView — DAW-style multi-track timeline. Layout:
 *   - A main grid: horizontal `TimeRuler` (top), N equal-flex track rows each
 *     carrying one `SourceStrip` *placed on the shared comparison timeline*,
 *     and a horizontal overview `MinimapDisplay` (bottom).
 *
 * Display controls (grid opacity, layer opacities, FFT / hop) live in the
 * transport's left region and arrive via the shared `settings` prop.
 *
 * No frequency axis, no dB axis, no frequency minimap, no selection, no cursor
 * readout chip — those stay Overlay/Slider concerns. The per-clip grid is
 * time-only (vertical lines aligned to the `TimeRuler`).
 *
 * **Shared comparison timeline.** Unlike the other per-source views, the
 * Timeline lays its strips out on one shared timeline: it spans `0` to
 * `max(timelineOffsetMs + durationMs)` across all renderable sources **plus a
 * headroom pad of the longest source's duration**, so every clip — including
 * the longest, and equal-length clips at offset 0 — has room to be dragged past
 * the current content end. Each clip is positioned horizontally so it starts at
 * its source's `timelineOffsetMs` and is sized proportionally to that source's
 * duration. A clip can be dragged (or arrow-key nudged) to re-place it; the new
 * offset is reported out via `onSourceOffsetChange` — the view owns no placement
 * state (controlled, props-in / callbacks-out). Transport playback drives
 * `positionSec`, and the playhead is positioned against the *timeline* span.
 *
 * Each track carries its own `AudioData` (resolved from the `sourceAudio` map
 * by id). Audibility (solo overrides mute) matches the other per-source views
 * so the DAW grammar carries through.
 */
export function TimelineView({
  sources,
  sourceAudio,
  channelInput,
  settings,
  onSourceOffsetChange,
  onTransportControlChange,
}: TimelineViewProps) {
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [cursorReadout, setCursorReadout] =
    useState<SourceStripCursorReadout>(DEFAULT_CURSOR);

  // Visible sources that have decoded audio, paired with their `AudioData`.
  const renderableSources = useMemo(
    () => resolveVisibleSourceAudio(sources, sourceAudio),
    [sources, sourceAudio],
  );

  // The shared comparison timeline span. It is the latest clip end across all
  // renderable sources (`timelineOffsetMs + durationMs`) **plus a headroom pad
  // of the longest source's duration**. The pad is deliberate: without it the
  // longest clip's `maxOffsetMs` (`span − duration`) would always be 0 — and
  // when every source has the same duration sitting at offset 0 (the common
  // null test: one take through different chains) *every* clip would be pinned
  // at 0 with a dead drag handle. Padding by one full clip-length gives every
  // renderable clip a positive draggable range — any clip can be pushed up to
  // one clip-length past the current content end. The `TimeRuler`, the overview
  // minimap, the per-track placement, and the playhead all lay out against this
  // same padded span so the visual layout stays coherent. A zero-duration
  // fallback when nothing is renderable.
  const timelineSpanMs = useMemo(() => {
    let contentEndMs = 0;
    let longestDurationMs = 0;

    for (const { source, audioData } of renderableSources) {
      const end = Math.max(0, source.timelineOffsetMs) + audioData.durationMs;

      if (end > contentEndMs) contentEndMs = end;
      if (audioData.durationMs > longestDurationMs) {
        longestDurationMs = audioData.durationMs;
      }
    }

    return contentEndMs + longestDurationMs;
  }, [renderableSources]);

  const durationSec = timelineSpanMs / 1000;

  // The overview minimap renders the whole timeline as a single waveform; with
  // N tracks placed at different offsets there is no one buffer that spans it,
  // so the minimap shows the first renderable source's audio as a stand-in
  // (its colour likewise). A neutral chrome pair when nothing is renderable.
  const minimapAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;
  const minimapColor = renderableSources[0]?.source.layerColor ?? {
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
        {/* Row 1 — time ruler across the full shared timeline. */}
        <TimeRuler startMs={0} endMs={timelineSpanMs} />

        {/* Row 2 — track stack + playhead. */}
        <div className="relative flex flex-col overflow-hidden bg-void">
          {renderableSources.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-body text-sm text-chrome-text-secondary">
                No visible sources.
              </p>
            </div>
          ) : (
            <>
              {renderableSources.map(({ source, audioData }) => (
                <TimelineTrack
                  key={source.id}
                  source={source}
                  audioData={audioData}
                  offsetMs={Math.max(0, source.timelineOffsetMs)}
                  timelineSpanMs={timelineSpanMs}
                  fftSize={settings.fftSize}
                  hopOverlap={settings.hopOverlap}
                  channelInput={channelInput}
                  gridOpacity={settings.gridOpacity}
                  waveformOpacity={settings.waveformOpacity}
                  spectrogramOpacity={settings.spectrogramOpacity}
                  draggable={onSourceOffsetChange !== undefined}
                  onCursorMove={setCursorReadout}
                  onOffsetChange={(offsetMs) => {
                    onSourceOffsetChange?.(source.id, offsetMs);
                  }}
                />
              ))}
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-data-cursor"
                style={{ left: `${playheadFrac * 100}%` }}
              />
            </>
          )}
        </div>

        {/* Row 3 — horizontal overview minimap across the full timeline. */}
        <MinimapDisplay
          audioData={minimapAudio}
          viewStartFrac={0}
          viewEndFrac={1}
          waveformColor={hexToRgb255(minimapColor.primary)}
        />
      </div>
    </div>
  );
}
