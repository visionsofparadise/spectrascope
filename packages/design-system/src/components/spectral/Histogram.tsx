import { useCallback, useEffect, useMemo, useRef } from "react";
import type { LayerColor } from "../../layers";

interface HistogramOverlay {
  readonly magnitudes: Float32Array | ReadonlyArray<number>;
  readonly layerColor: LayerColor;
}

interface HistogramProps {
  /**
   * Caller-computed magnitude samples in dBFS (or any dB scale that fits
   * `dbRange`). The component bins these into `binCount` buckets and renders
   * the resulting distribution. Stateless and pure — the page does the
   * binning input (not the FFT/RMS upstream).
   */
  readonly magnitudes: Float32Array | ReadonlyArray<number>;
  readonly layerColor: LayerColor;
  /** Number of dB bins along the X axis. Defaults to 60 (~1 dB per bin over [-60, 0]). */
  readonly binCount?: number;
  /** Visible dB range [min, max]. Defaults to [-60, 0] dBFS. */
  readonly dbRange?: readonly [number, number];
  /**
   * Additional layers to overlay on the same chart. Each renders in its own
   * `layerColor.primary` on top of the base layer with `mix-blend-mode: lighten`
   * so the distributions stay distinguishable.
   */
  readonly overlays?: ReadonlyArray<HistogramOverlay>;
  /** Optional explicit width/height for the canvas backing store sizing path. */
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

function binMagnitudes(
  magnitudes: Float32Array | ReadonlyArray<number>,
  binCount: number,
  dbMin: number,
  dbMax: number,
): Uint32Array {
  const counts = new Uint32Array(binCount);
  const range = dbMax - dbMin;

  if (range <= 0) return counts;

  for (let pos = 0; pos < magnitudes.length; pos++) {
    const db = magnitudes[pos] ?? dbMin;
    // Direct application of the formula from the plan:
    //   Math.floor(((dB - min) / (max - min)) * binCount)
    const raw = Math.floor(((db - dbMin) / range) * binCount);

    if (raw < 0) continue;
    if (raw >= binCount) continue;

    counts[raw] = (counts[raw] ?? 0) + 1;
  }

  return counts;
}

/**
 * Magnitude histogram — dB bins on X, frequency-of-occurrence on Y. A first-class
 * inspection view alongside the spectrogram and waveform. The caller computes
 * per-layer magnitude samples (e.g. by hopping over the visible time range and
 * taking peak/RMS in dB per hop) and passes them in; this component bins them
 * and renders bars in `layerColor.primary` at full opacity. Additional layers
 * stack via `overlays` with `mix-blend-mode: lighten` so distributions stay
 * distinguishable across layer hues — matches the Phase 3 compositing rule.
 *
 * Per the Layer Color Model, a layer's overlay traces draw in its `primary`.
 * Per the No-Opacity-on-Data rule, bars render at full opacity; the blend mode
 * is what produces the multi-layer readout, not alpha.
 */
export function Histogram({
  magnitudes,
  layerColor,
  binCount = 60,
  dbRange = [-60, 0],
  overlays,
  width,
  height,
  className,
}: HistogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dbMin, dbMax] = dbRange;

  const baseBins = useMemo(
    () => binMagnitudes(magnitudes, binCount, dbMin, dbMax),
    [magnitudes, binCount, dbMin, dbMax],
  );

  const overlayBins = useMemo(
    () =>
      (overlays ?? []).map((entry) => ({
        layerColor: entry.layerColor,
        counts: binMagnitudes(entry.magnitudes, binCount, dbMin, dbMax),
      })),
    [overlays, binCount, dbMin, dbMax],
  );

  // Shared peak across base + all overlays — every distribution scales against
  // the same Y axis so visual heights stay comparable across layers.
  const peakCount = useMemo(() => {
    let peak = 0;

    for (let pos = 0; pos < baseBins.length; pos++) {
      const count = baseBins[pos] ?? 0;

      if (count > peak) peak = count;
    }

    for (const entry of overlayBins) {
      for (let pos = 0; pos < entry.counts.length; pos++) {
        const count = entry.counts[pos] ?? 0;

        if (count > peak) peak = count;
      }
    }

    return peak;
  }, [baseBins, overlayBins]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(rect.height * dpr);

    if (pixelWidth === 0 || pixelHeight === 0) return;

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const gfx = canvas.getContext("2d");

    if (!gfx) return;

    gfx.clearRect(0, 0, pixelWidth, pixelHeight);

    if (peakCount === 0) return;

    const drawSeries = (counts: Uint32Array, fill: string) => {
      gfx.fillStyle = fill;

      const colWidth = pixelWidth / binCount;

      for (let pos = 0; pos < binCount; pos++) {
        const count = counts[pos] ?? 0;

        if (count === 0) continue;

        const normalized = count / peakCount;
        const barPixelHeight = normalized * pixelHeight;
        const x = pos * colWidth;
        // Inset 0.5 device-pixel on each side keeps bars crisp at any width.
        const barX = Math.floor(x) + 0.5;
        const barW = Math.max(1, Math.floor(colWidth) - 1);
        const barY = pixelHeight - barPixelHeight;

        gfx.fillRect(barX, barY, barW, barPixelHeight);
      }
    };

    // Base layer first, at full opacity, no blend.
    gfx.globalCompositeOperation = "source-over";
    drawSeries(baseBins, layerColor.primary);

    // Overlays use `lighten` so distinct hues stay distinguishable where they
    // intersect, matching the multi-layer compositing rule from Phase 3.
    if (overlayBins.length > 0) {
      gfx.globalCompositeOperation = "lighten";

      for (const entry of overlayBins) {
        drawSeries(entry.counts, entry.layerColor.primary);
      }

      gfx.globalCompositeOperation = "source-over";
    }
  }, [baseBins, overlayBins, layerColor.primary, peakCount, binCount]);

  useEffect(() => {
    render();

    const canvas = canvasRef.current;

    if (!canvas) return;

    const observer = new ResizeObserver(() => {
      render();
    });

    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, [render]);

  // Tick positions for the dB axis — at 0, -12, -24, -36, -48, -60 by default.
  // Step is derived from dbRange so non-default ranges still get evenly-spaced
  // labels.
  const tickStep = useMemo(() => {
    const span = Math.abs(dbMax - dbMin);

    if (span <= 0) return 12;
    if (span <= 24) return 6;
    if (span <= 60) return 12;

    return Math.round(span / 5);
  }, [dbMin, dbMax]);

  const ticks = useMemo(() => {
    const result: Array<number> = [];
    const lo = Math.min(dbMin, dbMax);
    const hi = Math.max(dbMin, dbMax);
    // Anchor ticks on multiples of tickStep so the labels land on round dB values.
    const first = Math.ceil(lo / tickStep) * tickStep;

    for (let tick = first; tick <= hi; tick += tickStep) {
      result.push(tick);
    }

    return result;
  }, [dbMin, dbMax, tickStep]);

  const dbSpan = dbMax - dbMin;

  return (
    <div
      className={`relative bg-void ${className ?? ""}`}
      style={width !== undefined && height !== undefined ? { width, height } : undefined}
    >
      {/* Plot area */}
      <div className="absolute left-0 right-6 top-0 bottom-4">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>

      {/* Y-axis label — "count" (normalized density implied by peak-scaling) */}
      <div className="pointer-events-none absolute right-0 top-0 bottom-4 flex w-6 flex-col justify-between items-start pl-1 font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-secondary">
        <span>{peakCount}</span>
        <span>0</span>
      </div>

      {/* X-axis labels — dB ticks. Positioned by fractional location across the
          plot area; the right gutter (w-6) matches the Y-label column so the
          tick at dbMax lands at the canvas's right edge. */}
      <div className="pointer-events-none absolute left-0 right-6 bottom-0 h-4 font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-secondary">
        {ticks.map((db) => {
          const frac = dbSpan === 0 ? 0 : (db - dbMin) / dbSpan;

          return (
            <span
              key={db}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${frac * 100}%` }}
            >
              {db}
            </span>
          );
        })}
      </div>
    </div>
  );
}
