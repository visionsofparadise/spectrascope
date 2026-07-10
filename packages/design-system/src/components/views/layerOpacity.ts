import { useState } from "react";

/**
 * Per-view layer-opacity state for the right-column opacity knobs.
 *
 * The five `SourceStrip`-based views (Overlay, Timeline, Slider, Difference,
 * Sum) each carry a right-column display-controls column with three
 * layer-opacity knobs — waveform, spectrogram, loudness. This hook holds the
 * three values so each view does not re-declare the same trio of `useState`
 * calls; the values are view-local (a transient display preference, like grid
 * opacity / FFT size), not comparison state.
 *
 * `waveformOpacity` and `spectrogramOpacity` route into `SourceStrip`'s
 * matching layer-opacity props — they drive the rendered opacity of the
 * waveform and spectrogram canvas layers. `loudnessOpacity` is held for a
 * consistent controlled knob, but `SourceStrip` has no loudness layer (it was
 * removed — the strip is spectrogram + waveform only), so the loudness knob
 * has no layer to drive in these views; its value is currently unconsumed.
 */
export interface LayerOpacity {
  readonly waveformOpacity: number;
  readonly spectrogramOpacity: number;
  readonly loudnessOpacity: number;
  readonly setWaveformOpacity: (next: number) => void;
  readonly setSpectrogramOpacity: (next: number) => void;
  readonly setLoudnessOpacity: (next: number) => void;
}

/** Default knob values — byte-identical to the pre-wiring visual-stub knobs. */
const DEFAULT_WAVEFORM_OPACITY = 0.8;
const DEFAULT_SPECTROGRAM_OPACITY = 0.7;
const DEFAULT_LOUDNESS_OPACITY = 0.5;

/**
 * Holds the three layer-opacity knob values for a view. Initialized to the
 * historical stub defaults (`0.8` / `0.7` / `0.5`) so a freshly-opened view
 * looks identical to before the knobs were wired.
 */
export function useLayerOpacity(): LayerOpacity {
  const [waveformOpacity, setWaveformOpacity] = useState(
    DEFAULT_WAVEFORM_OPACITY,
  );
  const [spectrogramOpacity, setSpectrogramOpacity] = useState(
    DEFAULT_SPECTROGRAM_OPACITY,
  );
  const [loudnessOpacity, setLoudnessOpacity] = useState(
    DEFAULT_LOUDNESS_OPACITY,
  );

  return {
    waveformOpacity,
    spectrogramOpacity,
    loudnessOpacity,
    setWaveformOpacity,
    setSpectrogramOpacity,
    setLoudnessOpacity,
  };
}
