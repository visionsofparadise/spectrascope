import { useEffect, useMemo, useRef, useState } from "react";
import { WaveformCanvas, useSpectralCompute } from "spectral-display";
import type { SpectralOptions } from "spectral-display";
import type { AudioData } from "./types";

interface MinimapDisplayProps {
  readonly audioData: AudioData;
  /** Left edge of the viewport bracket as a fraction of the full duration (0..1). */
  readonly viewStartFrac: number;
  /** Right edge of the viewport bracket as a fraction of the full duration (0..1). */
  readonly viewEndFrac: number;
  /** Waveform RGB color (0..255 per channel) — see SourceStrip.hexToRgb255. */
  readonly waveformColor: readonly [number, number, number];
}

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 800, height: 48 });

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
 * Horizontal overview strip — renders the full audio waveform at minimap
 * resolution, with the visible viewport region bracketed and the surrounding
 * area dimmed. Pair with `FrequencyMinimap` (vertical) to give the user a
 * 2D zoom/pan overview of the source.
 *
 * Ported from the pre-deletion SpectralPage `MinimapDisplay`
 * (`archive/spectralpage-reference.tsx` lines ~276-323), generalised to take
 * the viewport fractions as props rather than reading module constants.
 */
export function MinimapDisplay({
  audioData,
  viewStartFrac,
  viewEndFrac,
  waveformColor,
}: MinimapDisplayProps) {
  const minimapRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(minimapRef);

  const color = useMemo<[number, number, number]>(
    () => [waveformColor[0], waveformColor[1], waveformColor[2]],
    [waveformColor],
  );

  const spectralOptions = useMemo<SpectralOptions>(
    () => ({
      metadata: {
        sampleRate: audioData.sampleRate,
        sampleCount: audioData.totalSamples,
        channelCount: audioData.channels,
      },
      query: { startMs: 0, endMs: audioData.durationMs, width, height },
      readSamples: audioData.readSamples,
      config: {
        spectrogram: false,
        loudness: false,
      },
    }),
    [audioData, width, height],
  );

  const computeResult = useSpectralCompute(spectralOptions);

  const vpStartPct = viewStartFrac * 100;
  const vpWidthPct = (viewEndFrac - viewStartFrac) * 100;

  return (
    <div ref={minimapRef} className="relative h-12 bg-void">
      {computeResult.status === "ready" && (
        <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
          <WaveformCanvas computeResult={computeResult} color={color} />
        </div>
      )}
      <div
        className="absolute inset-y-0 left-0 bg-black/65"
        style={{ width: `${vpStartPct}%` }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-black/65"
        style={{ width: `${(1 - viewEndFrac) * 100}%` }}
      />
      {/* Viewport bracket — the scroll-window indicator. No grab-handle chips;
          the bracket box itself is the affordance. */}
      <div
        className="absolute inset-y-0 cursor-ew-resize border-2 border-data-selection-border"
        style={{ left: `${vpStartPct}%`, width: `${vpWidthPct}%` }}
      />
    </div>
  );
}
