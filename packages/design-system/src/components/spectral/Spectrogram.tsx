import { useRef, useEffect, useCallback, useMemo } from "react";
import type { ColormapDefinition } from "spectral-display";
import { buildLayerColormap } from "../../layers";
import type { LayerColor } from "../../layers";
import type { AudioDisplayData } from "./types";

function interpolateColormap(colormap: ColormapDefinition, value: number): [number, number, number] {
  const stops = colormap.colors;
  const clamped = Math.max(0, Math.min(1, value));
  const first = stops[0];
  const last = stops[stops.length - 1];

  if (!first || !last) return [0, 0, 0];

  let lo = first;
  let hi = last;

  for (let si = 0; si < stops.length - 1; si++) {
    const lower = stops[si];
    const upper = stops[si + 1];

    if (!lower || !upper) continue;

    if (clamped >= lower.position && clamped <= upper.position) {
      lo = lower;
      hi = upper;
      break;
    }
  }

  const range = hi.position - lo.position;
  const factor = range > 0 ? (clamped - lo.position) / range : 0;

  return [
    Math.round(lo.color[0] + (hi.color[0] - lo.color[0]) * factor),
    Math.round(lo.color[1] + (hi.color[1] - lo.color[1]) * factor),
    Math.round(lo.color[2] + (hi.color[2] - lo.color[2]) * factor),
  ];
}

interface SpectrogramProps {
  readonly data: AudioDisplayData;
  readonly startMs: number;
  readonly endMs: number;
  readonly layerColor: LayerColor;
}

export function Spectrogram({ data, startMs, endMs, layerColor }: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colormap = useMemo(() => buildLayerColormap(layerColor), [layerColor]);

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

    const imageData = gfx.createImageData(width, height);
    const pixels = imageData.data;

    const durationMs = data.duration * 1000;
    const startFrac = startMs / durationMs;
    const endFrac = endMs / durationMs;

    for (let px = 0; px < width; px++) {
      const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
      const frameIndex = Math.floor(timeFrac * data.timeFrames);
      const clampedFrame = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
      const frame = data.spectrogram[clampedFrame];

      if (!frame) continue;

      for (let py = 0; py < height; py++) {
        const freqFrac = 1 - py / height;
        const binIndex = Math.floor(freqFrac * data.freqBins);
        const clampedBin = Math.max(0, Math.min(data.freqBins - 1, binIndex));
        const value = frame[clampedBin] ?? 0;

        const rgb = interpolateColormap(colormap, value);
        const pixelOffset = (py * width + px) * 4;

        pixels[pixelOffset] = rgb[0];
        pixels[pixelOffset + 1] = rgb[1];
        pixels[pixelOffset + 2] = rgb[2];
        pixels[pixelOffset + 3] = 255;
      }
    }

    gfx.putImageData(imageData, 0, 0);
  }, [data, startMs, endMs, colormap]);

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
