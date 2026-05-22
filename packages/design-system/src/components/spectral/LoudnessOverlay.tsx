import { useRef, useEffect, useCallback } from "react";
import type { LayerColor } from "../../layers";
import type { AudioDisplayData } from "./types";

interface LoudnessOverlayProps {
  readonly data: AudioDisplayData;
  readonly startMs: number;
  readonly endMs: number;
  readonly layerColor: LayerColor;
}

export function LoudnessOverlay({ data, startMs, endMs, layerColor }: LoudnessOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Per the Layer Color Model: all of a layer's overlay traces draw in
  // layerColor.primary. Per-trace color variation (lava-rms/lava-lufs/lava-peak)
  // is retired — traces are differentiated by line weight and dash pattern only.
  const traceColor = layerColor.primary;

  const render = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (width === 0 || height === 0) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const gfx = canvas.getContext("2d");

    if (!gfx) return;

    gfx.clearRect(0, 0, width, height);

    const durationMs = data.duration * 1000;
    const startFrac = startMs / durationMs;
    const endFrac = endMs / durationMs;

    const dbMin = -40;
    const dbMax = 0;
    const dbRange = dbMax - dbMin;

    function dbToY(db: number): number {
      const normalized = (db - dbMin) / dbRange;

      return (1 - Math.max(0, Math.min(1, normalized))) * height;
    }

    // Draw RMS envelope
    gfx.beginPath();
    gfx.strokeStyle = traceColor;
    gfx.lineWidth = 1.5 * dpr;
    gfx.globalAlpha = 0.35;

    for (let px = 0; px < width; px++) {
      const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
      const frameIndex = Math.floor(timeFrac * data.timeFrames);
      const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
      const rmsDb = data.loudness.rms[clamped] ?? dbMin;
      const py = dbToY(rmsDb);

      if (px === 0) {
        gfx.moveTo(px, py);
      } else {
        gfx.lineTo(px, py);
      }
    }

    gfx.stroke();
    gfx.globalAlpha = 1;

    // Draw LUFS
    gfx.beginPath();
    gfx.strokeStyle = traceColor;
    gfx.lineWidth = 1 * dpr;
    gfx.globalAlpha = 0.8;

    for (let px = 0; px < width; px++) {
      const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
      const frameIndex = Math.floor(timeFrac * data.timeFrames);
      const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
      const lufsDb = data.loudness.lufs[clamped] ?? dbMin;
      const py = dbToY(lufsDb);

      if (px === 0) {
        gfx.moveTo(px, py);
      } else {
        gfx.lineTo(px, py);
      }
    }

    gfx.stroke();
    gfx.globalAlpha = 1;

    // Draw Peak as dashed line at max peak
    gfx.beginPath();
    gfx.strokeStyle = traceColor;
    gfx.lineWidth = 1 * dpr;
    gfx.setLineDash([4 * dpr, 3 * dpr]);
    gfx.globalAlpha = 0.7;

    for (let px = 0; px < width; px++) {
      const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
      const frameIndex = Math.floor(timeFrac * data.timeFrames);
      const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
      const peakDb = data.loudness.peak[clamped] ?? dbMin;
      const py = dbToY(peakDb);

      if (px === 0) {
        gfx.moveTo(px, py);
      } else {
        gfx.lineTo(px, py);
      }
    }

    gfx.stroke();
    gfx.setLineDash([]);
    gfx.globalAlpha = 1;
  }, [data, startMs, endMs, traceColor]);

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

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
