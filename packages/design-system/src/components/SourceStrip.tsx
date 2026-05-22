import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SpectrogramCanvas,
  WaveformCanvas,
  useSpectralCompute,
} from "spectral-display";
import type {
  ColormapDefinition,
  SpectralOptions,
} from "spectral-display";
import { buildLayerColormap } from "../layers";
import type { Source } from "../source";
import type { AudioData } from "./spectral/types";

/**
 * Cursor readout shape — `{ time, freq, amp }` strings the strip publishes up
 * on mouse-move.
 */
export interface SourceStripCursorReadout {
  readonly time: string;
  readonly freq: string;
  readonly amp: string;
}

export interface SourceStripProps {
  /** Source identity + per-source `layerColor` + `gainDb`. */
  readonly source: Source;
  readonly audioData: AudioData;
  readonly startMs: number;
  readonly endMs: number;
  readonly fftSize: number;
  readonly hopOverlap: number;
  readonly opacity?: number;
  readonly clipPath?: string;
  readonly onCursorMove?: (readout: SourceStripCursorReadout) => void;
}

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 800, height: 400 });

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) return;

      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return size;
}

/**
 * Parse `#RRGGBB` (or `#RGB`) into a `[r, g, b]` triple of integer 0..255
 * components. `WaveformCanvas` consumes 0..255 (its shader divides by 255).
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
    return [255, 255, 255];
  }

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * SourceStrip — the atomic per-source visual unit. Spectrogram + waveform
 * only; the loudness overlay was removed in the second iteration.
 *
 * Per-source gain is applied at the PCM boundary by wrapping `readSamples` to
 * multiply each sample by `10^(gainDb/20)`. When `gainDb === 0` the original
 * reader is passed through unchanged so identity stays stable.
 */
export function SourceStrip({
  source,
  audioData,
  startMs,
  endMs,
  fftSize,
  hopOverlap,
  opacity = 1,
  clipPath,
  onCursorMove,
}: SourceStripProps) {
  const displayRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(displayRef);

  const colormap = useMemo<ColormapDefinition>(
    () => buildLayerColormap(source.layerColor),
    [source.layerColor],
  );

  const waveformColor = useMemo<[number, number, number]>(
    () => hexToRgb255(source.layerColor.primary),
    [source.layerColor.primary],
  );

  const handleMouseMove = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>) => {
      if (!onCursorMove || !displayRef.current) return;

      const rect = displayRef.current.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) return;

      const xFrac = (ev.clientX - rect.left) / rect.width;
      const yFrac = (ev.clientY - rect.top) / rect.height;

      const timeMs = startMs + xFrac * (endMs - startMs);
      const totalSec = timeMs / 1000;
      const mins = Math.floor(totalSec / 60);
      const secs = Math.floor(totalSec % 60);
      const ms = Math.floor((totalSec % 1) * 1000);
      const timeStr = `${mins.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

      const logMin = Math.log10(20);
      const logMax = Math.log10(20000);
      const freqHz = Math.pow(10, logMax - yFrac * (logMax - logMin));
      const freqStr =
        freqHz >= 1000
          ? `${(freqHz / 1000).toFixed(1)} kHz`
          : `${Math.round(freqHz)} Hz`;

      const baseAmp = -60 + (1 - yFrac) * 55 + (Math.random() - 0.5) * 6;
      const ampStr = `${baseAmp.toFixed(1)} dB`;

      onCursorMove({ time: timeStr, freq: freqStr, amp: ampStr });
    },
    [onCursorMove, startMs, endMs],
  );

  // Wrap `readSamples` to apply per-source gain. When gainDb is exactly 0 the
  // original reader is passed through so we don't churn function identity (and
  // thus `useSpectralCompute`'s dependency) for the common case.
  const gainAdjustedReadSamples = useMemo<AudioData["readSamples"]>(() => {
    if (source.gainDb === 0) {
      return audioData.readSamples;
    }

    const linear = Math.pow(10, source.gainDb / 20);

    return async (channel, sampleOffset, sampleCount) => {
      const raw = await audioData.readSamples(channel, sampleOffset, sampleCount);
      const scaled = new Float32Array(raw.length);

      for (let index = 0; index < raw.length; index += 1) {
        const sample = raw[index] ?? 0;

        scaled[index] = sample * linear;
      }

      return scaled;
    };
  }, [audioData.readSamples, source.gainDb]);

  const spectralOptions = useMemo<SpectralOptions>(
    () => ({
      metadata: {
        sampleRate: audioData.sampleRate,
        sampleCount: audioData.totalSamples,
        channelCount: audioData.channels,
      },
      query: { startMs, endMs, width, height },
      readSamples: gainAdjustedReadSamples,
      config: {
        fftSize,
        hopOverlap,
        frequencyScale: "mel",
        colormap,
        loudness: false,
        truePeak: false,
      },
    }),
    [
      audioData.sampleRate,
      audioData.totalSamples,
      audioData.channels,
      gainAdjustedReadSamples,
      startMs,
      endMs,
      width,
      height,
      fftSize,
      hopOverlap,
      colormap,
    ],
  );

  const computeResult = useSpectralCompute(spectralOptions);

  return (
    <div
      ref={displayRef}
      className="absolute inset-0 overflow-hidden bg-void"
      style={{ opacity, clipPath }}
      onMouseMove={handleMouseMove}
    >
      {computeResult.status === "ready" && (
        <>
          <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
            <SpectrogramCanvas computeResult={computeResult} />
          </div>
          <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
            <WaveformCanvas computeResult={computeResult} color={waveformColor} />
          </div>
        </>
      )}
    </div>
  );
}
