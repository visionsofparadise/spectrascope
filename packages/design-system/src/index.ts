/* eslint-disable barrel-files/avoid-barrel-files */
// Components — Controls
export { Knob } from "./components/controls/Knob";
export { Fader } from "./components/controls/Fader";
export { Meter } from "./components/controls/Meter";
export { ButtonSelection } from "./components/controls/ButtonSelection";

// Components — Primitives
export { Button } from "./components/Button";
export type { ButtonProps } from "./components/Button";
export { Input } from "./components/Input";
export type { InputProps } from "./components/Input";
export { Select } from "./components/Select";
export type { SelectProps } from "./components/Select";
export { Toggle } from "./components/Toggle";
export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuGroup,
	DropdownMenuPortal,
	DropdownMenuSub,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
} from "./components/DropdownMenu";
export { IconButton } from "./components/IconButton";
export { DropdownButton } from "./components/DropdownButton";
export type { DropdownButtonProps, MenuItem } from "./components/DropdownButton";
export { TerrainShader } from "./components/TerrainShader";
export { LayerColorPicker } from "./components/LayerColorPicker";
export { AppShell } from "./components/AppShell";
export { SourceRow } from "./components/SourceRow";
export { SourcesPanel } from "./components/SourcesPanel";
export { ViewTabs } from "./components/ViewTabs";
export type { ViewId } from "./components/ViewTabs";
export { Workspace } from "./components/Workspace";
export { SourceStrip } from "./components/SourceStrip";
export type { SourceStripProps, SourceStripCursorReadout } from "./components/SourceStrip";
export { CorrelationView } from "./components/views/CorrelationView";
export { DifferenceView } from "./components/views/DifferenceView";
export { FrequencyDistributionView } from "./components/views/FrequencyDistributionView";
export { LoudnessView } from "./components/views/LoudnessView";
export { OverlayView } from "./components/views/OverlayView";
export { SliderView } from "./components/views/SliderView";
export { SumView } from "./components/views/SumView";
export { TimelineView } from "./components/views/TimelineView";
export { VectorscopeView } from "./components/views/VectorscopeView";

// Spectral
export { Curtain } from "./components/spectral/Curtain";
export { Spectrogram } from "./components/spectral/Spectrogram";
export { Waveform } from "./components/spectral/Waveform";
export { FrequencyAxis, DbAxis, ColormapGradient, TimeRuler, LinearDbAxis, HorizontalTimeAxis } from "./components/spectral/Axes";
export { FrequencyMinimap } from "./components/spectral/FrequencyMinimap";
export { Histogram } from "./components/spectral/Histogram";
export { LoudnessOverlay } from "./components/spectral/LoudnessOverlay";
export { LoudnessKey } from "./components/spectral/LoudnessKey";
export { Minimap } from "./components/spectral/Minimap";
export { MinimapDisplay } from "./components/spectral/MinimapDisplay";
export { NodeNav } from "./components/spectral/NodeNav";
export { Selection } from "./components/spectral/Selection";
export { StereoMeter } from "./components/spectral/StereoMeter";
export { Transport } from "./components/spectral/Transport";
export type { TransportControl, TransportCursorReadout } from "./components/spectral/Transport";
export { ZoomSliders } from "./components/spectral/ZoomSliders";
export type { AudioDisplayData, WaveformFrame, LoudnessData, AudioData } from "./components/spectral/types";

// Layers
export type { LayerColor } from "./layers";
export { DEFAULT_LAYER_PALETTE, buildLayerColormap } from "./layers";

// Source (workspace shell)
export type { Source } from "./source";
export { createDefaultSource } from "./source";

// Sync
export { SyncProvider, useSync, useViewSync } from "./sync";
export type { SyncState, SyncContextValue, ViewSync } from "./sync";

// Utilities
export { cn } from "./cn";
