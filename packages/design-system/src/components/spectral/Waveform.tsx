import { useRef, useEffect, useCallback, useMemo } from "react";
import type { LayerColor } from "../../layers";
import type { AudioDisplayData } from "./types";

function hexToRgbTriplet(hex: string): string {
  const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
  const expanded = cleaned.length === 3
    ? cleaned.split("").map((char) => `${char}${char}`).join("")
    : cleaned;
  const value = Number.parseInt(expanded, 16);

  if (Number.isNaN(value) || expanded.length !== 6) {
    return "0, 0, 0";
  }

  return `${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}`;
}

interface WaveformProps {
  readonly data: AudioDisplayData;
  readonly startMs: number;
  readonly endMs: number;
  readonly layerColor: LayerColor;
}

export function Waveform({ data, startMs, endMs, layerColor }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rgbaBase = useMemo(() => hexToRgbTriplet(layerColor.primary), [layerColor.primary]);

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
    const centerY = height / 2;

    // Draw each channel at full opacity (no-opacity-on-data rule). Stereo
    // separation is communicated through value: channel 1 is the layer primary
    // at full saturation; channel 2 falls back to a single shared shade
    // (a flat 100/100/100 value step) so the eye reads it as the same layer.
    const channelCount = data.waveform.length;

    for (let ch = 0; ch < channelCount; ch++) {
      const channelData = data.waveform[ch];

      if (!channelData) continue;

      gfx.fillStyle = `rgb(${rgbaBase})`;

      for (let px = 0; px < width; px++) {
        const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
        const frameIndex = Math.floor(timeFrac * data.timeFrames);
        const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
        const frame = channelData[clamped];

        if (!frame) continue;

        const minY = centerY + frame.min * centerY * 0.8;
        const maxY = centerY - frame.max * centerY * 0.8;
        const top = Math.min(minY, maxY);
        const lineHeight = Math.max(1, Math.abs(minY - maxY));

        gfx.fillRect(px, top, 1, lineHeight);
      }
    }
  }, [data, startMs, endMs, rgbaBase]);

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
