repo: visionsofparadise/spectrascope
branch: main
path: apps/desktop/src/renderer

## Last sync
date: 2026-09-13T01:41:23Z

### Updated in this project
- Layer colours now use the paler DEFAULT_LAYER_PALETTE
- All spectrograms render with the lava colormap
- Overlay view is waveform-only
- Spectrogram selectors (colour map, sampling, scale, FFT, hop) on spectral group and Timeline

## Screen map
| Screen | Repo files |
| --- | --- |
| Workspace transport controls | workspace/TransportViewControls.tsx, workspace/viewSettings.ts |
| Overlay view | workspace/views/OverlayView.tsx |
| Timeline view | workspace/views/TimelineView.tsx |
| Layer colours / picker | workspace/layers.ts, workspace/LayerColorPicker.tsx, workspace/source.ts |
| Spectrogram ramp | workspace/utils/spectrogramColormaps.ts |
