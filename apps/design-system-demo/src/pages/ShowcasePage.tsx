import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Crosshair,
  Layers,
  Maximize2,
  Pause,
  Play,
  Settings,
  Square,
  X,
} from "lucide-react";
import {
  AppShell,
  Button,
  ButtonSelection,
  CorrelationView,
  Curtain,
  DEFAULT_LAYER_PALETTE,
  DifferenceView,
  Fader,
  FrequencyDistributionView,
  Histogram,
  Input,
  Knob,
  LayerColorPicker,
  LoudnessView,
  Meter,
  OverlayView,
  SliderView,
  SourceRow,
  SourceStrip,
  SourcesPanel,
  SumView,
  SyncProvider,
  TimelineView,
  Transport,
  VectorscopeView,
  ViewTabs,
  createDefaultSource,
  useSync,
} from "@spectrascope/design-system";
import type {
  AudioData,
  LayerColor,
  Source,
  SyncState,
  TransportControl,
  ViewId,
} from "@spectrascope/design-system";
import type { ChannelInput } from "spectral-display";
import { loadAudio } from "../data/audioLoader";

const SHOWCASE_LAYER_FALLBACK: LayerColor = { primary: "#F59E0B", secondary: "#7C2D12" };
const SHOWCASE_LAYER: LayerColor = DEFAULT_LAYER_PALETTE[0] ?? SHOWCASE_LAYER_FALLBACK;
const SHOWCASE_LAYER_B: LayerColor = DEFAULT_LAYER_PALETTE[1] ?? { primary: "#5EC4B6", secondary: "#0F3D38" };

const CHROME = [
  { token: "void", hex: "#020204" },
  { token: "chrome-base", hex: "#0D0D0F" },
  { token: "chrome-surface", hex: "#1E1E23" },
  { token: "chrome-raised", hex: "#28282E" },
  { token: "chrome-border", hex: "#2A2A30" },
  { token: "chrome-border-subtle", hex: "#1F1F24" },
  { token: "chrome-text", hex: "#B8B8C0" },
  { token: "chrome-text-secondary", hex: "#6E6E78" },
  { token: "chrome-text-dim", hex: "#44444C" },
] as const;

const ACCENT = [
  { token: "primary", hex: "#A3E635", label: "Neon Lime" },
  { token: "secondary", hex: "#440154", label: "Viridis Purple" },
  { token: "interactive-focus", hex: "#A3E635", label: "Focus Ring (aliases primary)" },
] as const;

const STATE = [
  { token: "state-rendered", hex: "#34D399", label: "Rendered" },
  { token: "state-stale", hex: "#FBBF24", label: "Stale" },
  { token: "state-processing", hex: "#60A5FA", label: "Processing" },
  { token: "state-error", hex: "#F87171", label: "Error" },
  { token: "state-bypassed", hex: "#44444C", label: "Bypassed" },
] as const;

const DATA_OVERLAY = [
  { token: "data-cursor", hex: "#E0E0E8", label: "Cursor" },
  { token: "data-selection", hex: "#5A9ECF20", label: "Selection Fill" },
  { token: "data-selection-border", hex: "#5A9ECF", label: "Selection Border" },
] as const;

const EDGE = [
  { token: "edge-idle", hex: "#2A2A30", label: "Idle" },
  { token: "edge-active", hex: "#60A5FA", label: "Active" },
  { token: "edge-complete", hex: "#34D399", label: "Complete" },
] as const;

const TYPE_SCALE = [
  { token: "text-3xl", rem: "3rem", usage: "Logo / display" },
  { token: "text-2xl", rem: "2rem", usage: "Hero" },
  { token: "text-xl", rem: "1.5rem", usage: "Large headings" },
  { token: "text-lg", rem: "1.125rem", usage: "View titles" },
  { token: "text-md", rem: "1rem", usage: "Section headers" },
  { token: "text-base", rem: "0.875rem", usage: "Primary UI text" },
  { token: "text-sm", rem: "0.8125rem", usage: "Labels, parameters" },
  { token: "text-xs", rem: "0.75rem", usage: "Axis ticks, metadata" },
] as const;

const SPACING_SCALE = [
  { token: "space-1", rem: "0.25rem", px: 4, usage: "Tight internal padding" },
  { token: "space-2", rem: "0.5rem", px: 8, usage: "Standard internal padding" },
  { token: "space-3", rem: "0.75rem", px: 12, usage: "Panel content padding" },
  { token: "space-4", rem: "1rem", px: 16, usage: "Section gaps" },
  { token: "space-6", rem: "1.5rem", px: 24, usage: "Major section separation" },
] as const;

const ICONS = [
  { name: "Play", Component: Play },
  { name: "Pause", Component: Pause },
  { name: "Square", Component: Square },
  { name: "Layers", Component: Layers },
  { name: "Crosshair", Component: Crosshair },
  { name: "Activity", Component: Activity },
  { name: "Maximize2", Component: Maximize2 },
  { name: "ChevronDown", Component: ChevronDown },
  { name: "Settings", Component: Settings },
  { name: "X", Component: X },
] as const;

function Section({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b border-chrome-border-subtle p-6">
      <p className="font-technical text-[length:var(--text-sm)] uppercase tracking-[0.1em] text-primary">{label}</p>
      {children}
    </div>
  );
}

function SubSection({
  label,
  description,
  children,
}: {
  readonly label: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">
        {label}
      </h3>
      <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">{description}</p>
      <div className="pt-2">{children}</div>
    </div>
  );
}

// --- Pre-existing showcase demos (unchanged) ---------------------------------

function LayerPaletteDemo() {
  const [layer, setLayer] = useState<LayerColor>(SHOWCASE_LAYER);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-3">
        {DEFAULT_LAYER_PALETTE.map((entry, index) => (
          <div key={`${entry.primary}-${String(index)}`} className="flex items-center gap-3">
            <div className="flex">
              <div className="h-8 w-8" style={{ backgroundColor: entry.primary }} />
              <div className="h-8 w-8" style={{ backgroundColor: entry.secondary }} />
            </div>
            <div>
              <span className="block font-body text-[length:var(--text-sm)] text-chrome-text">Layer {index + 1}</span>
              <span className="block font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{entry.primary} / {entry.secondary}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-6 border-t border-chrome-border-subtle pt-4">
        <div className="flex flex-col gap-2">
          <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">LayerColorPicker</span>
          <LayerColorPicker value={layer} onChange={setLayer} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Spectrogram Ramp (void to secondary)</span>
          <div
            className="h-4 w-64"
            style={{ background: `linear-gradient(to right, #020204, ${layer.secondary})` }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Waveform / Trace (primary)</span>
          <div className="h-4 w-16" style={{ background: layer.primary }} />
        </div>
      </div>
    </div>
  );
}

function MiniCurtainDemo() {
  const [pos, setPos] = useState(0.5);
  const layerA = SHOWCASE_LAYER;
  const layerB = SHOWCASE_LAYER_B;
  const leftClip = `inset(0 ${String((1 - pos) * 100)}% 0 0)`;
  const rightClip = `inset(0 0 0 ${String(pos * 100)}%)`;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-8 w-full overflow-hidden bg-void">
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to right, #020204, ${layerA.secondary})`,
            clipPath: leftClip,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to right, #020204, ${layerB.secondary})`,
            clipPath: rightClip,
          }}
        />
        <Curtain position={pos} onPositionChange={setPos} />
      </div>
      <div className="flex justify-between font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">
        <span>Layer A · {layerA.secondary}</span>
        <span>{(pos * 100).toFixed(0)}%</span>
        <span>Layer B · {layerB.secondary}</span>
      </div>
    </div>
  );
}

function buildGaussianMagnitudes(center: number, width: number, sampleCount: number, dbRange: readonly [number, number]): Float32Array {
  const out = new Float32Array(sampleCount);
  const [lo, hi] = dbRange;

  let seed = 0x12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;

    return seed / 0xffffffff;
  };

  for (let pos = 0; pos < sampleCount; pos++) {
    const u1 = Math.max(1e-9, rand());
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const db = center + z * width;

    out[pos] = Math.max(lo, Math.min(hi, db));
  }

  return out;
}

function MiniHistogramDemo() {
  const magnitudes = useMemo(
    () => buildGaussianMagnitudes(-20, 8, 4096, [-60, 0]),
    [],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="h-20 w-full">
        <Histogram magnitudes={magnitudes} layerColor={SHOWCASE_LAYER} dbRange={[-60, 0]} />
      </div>
    </div>
  );
}

function MiniSyncedStrip({ id, magnitudes, layerColor, dbRange }: {
  readonly id: string;
  readonly magnitudes: Float32Array;
  readonly layerColor: LayerColor;
  readonly dbRange: readonly [number, number];
}) {
  const sync = useSync(id);
  const [lo, hi] = dbRange;
  const span = hi - lo;
  const cursorFrac = sync.state.cursor === null ? null : (sync.state.cursor - lo) / span;

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width <= 0) return;

    const frac = (event.clientX - rect.left) / rect.width;
    const clamped = Math.min(1, Math.max(0, frac));
    const db = lo + clamped * span;

    sync.setCursor(db);
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        className="relative h-16 w-full cursor-crosshair"
        onClick={handleClick}
      >
        <Histogram magnitudes={magnitudes} layerColor={layerColor} dbRange={dbRange} />
        {cursorFrac !== null && cursorFrac >= 0 && cursorFrac <= 1 ? (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-data-cursor"
            style={{ left: `${String(cursorFrac * 100)}%` }}
          />
        ) : null}
      </div>
      <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">
        {id} · cursor {sync.state.cursor === null ? "—" : `${sync.state.cursor.toFixed(1)} dB`}
      </span>
    </div>
  );
}

function MiniSyncedPairDemo() {
  const magsA = useMemo(() => buildGaussianMagnitudes(-24, 7, 4096, [-60, 0]), []);
  const magsB = useMemo(() => buildGaussianMagnitudes(-12, 5, 4096, [-60, 0]), []);
  const initial: SyncState = useMemo(
    () => ({ cursor: null, selection: null, timeRange: { start: -60, end: 0 } }),
    [],
  );

  return (
    <SyncProvider enabled initial={initial}>
      <div className="grid grid-cols-2 gap-4">
        <MiniSyncedStrip id="synced-a" magnitudes={magsA} layerColor={SHOWCASE_LAYER} dbRange={[-60, 0]} />
        <MiniSyncedStrip id="synced-b" magnitudes={magsB} layerColor={SHOWCASE_LAYER_B} dbRange={[-60, 0]} />
      </div>
      <p className="font-body text-[length:var(--text-xs)] text-chrome-text-secondary">
        Click on either strip to move the cursor; both views read from the same SyncProvider.
      </p>
    </SyncProvider>
  );
}

function ControlsDemo() {
  const [knobA, setKnobA] = useState(0.65);
  const [knobB, setKnobB] = useState(0.3);
  const [knobC, setKnobC] = useState(0.85);
  const [faderA, setFaderA] = useState(0.75);
  const [faderB, setFaderB] = useState(0.5);
  const [selection, setSelection] = useState("LUFS");

  return (
    <div className="grid grid-cols-4 gap-6">
      <div className="flex flex-col gap-2">
        <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Knobs</span>
        <div className="flex items-end gap-4">
          <Knob value={knobA} label="Gain" onChange={setKnobA} />
          <Knob value={knobB} label="Freq" onChange={setKnobB} />
          <Knob value={knobC} label="Mix" onChange={setKnobC} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Faders</span>
        <div className="flex items-end gap-4">
          <Fader value={faderA} label="Vol" onChange={setFaderA} />
          <Fader value={faderB} label="Pan" onChange={setFaderB} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Meters</span>
        <div className="flex items-end gap-2">
          <Meter level={0.7} animated layerColor={SHOWCASE_LAYER} />
          <Meter level={0.5} animated layerColor={SHOWCASE_LAYER} />
          <Meter level={0.85} animated layerColor={SHOWCASE_LAYER} />
          <Meter level={0.3} animated layerColor={SHOWCASE_LAYER} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Button Selection</span>
        <ButtonSelection options={["Peak", "RMS", "LUFS"]} active={selection} onSelect={setSelection} />
        <ButtonSelection options={["Mono", "Stereo", "Mid/Side", "Surround"]} active="Stereo" columns={2} />
      </div>
    </div>
  );
}

// --- Workspace-shell demos (new in Phase 10) ---------------------------------

/** Seed a stable, named source list for the workspace-shell demos. Three
 *  sources cycles the default palette enough to show layer-color separation. */
function seedDemoSources(count: number): Array<Source> {
  const names = ["Reference", "Candidate", "Take 3", "Take 4"];
  const paths = [
    "demo/reference-mix.wav",
    "demo/candidate-mix.wav",
    "demo/take-03.wav",
    "demo/take-04.wav",
  ];

  return Array.from({ length: count }, (_, index) =>
    createDefaultSource(index, {
      name: names[index] ?? `Source ${index + 1}`,
      audioFilePath: paths[index] ?? `demo/source-${index + 1}.wav`,
    }),
  );
}

const DISABLED_TRANSPORT_CONTROL: TransportControl = {
  disabled: true,
  playing: false,
  positionSec: 0,
  durationSec: 0,
  onPlayToggle: () => {},
  onSeek: () => {},
};

function AppShellPreview() {
  // Sized-down framed example. The real AppShell is `h-screen w-screen`; here
  // we wrap it in a 480x320 frame so the layout is legible inline. A stub
  // sidebar / workspace / Transport keeps the demo cheap.
  const stubSources = useMemo(() => seedDemoSources(2), []);

  return (
    <div className="h-[320px] w-[480px] overflow-hidden border border-chrome-border bg-chrome-base">
      {/* Override AppShell's h-screen/w-screen so it fills our wrapper. */}
      <div className="h-full w-full [&>div]:h-full [&>div]:w-full">
        <AppShell
          sidebar={
            <div className="flex h-full flex-col bg-chrome-surface">
              <div className="flex h-8 shrink-0 items-center border-b border-chrome-border-subtle px-3">
                <span className="font-technical text-sm uppercase tracking-[0.06em] text-chrome-text-secondary">
                  Sources
                </span>
              </div>
              <ul className="flex flex-col">
                {stubSources.map((source) => (
                  <li key={source.id}>
                    <SourceRow
                      source={source}
                      onChange={() => {}}
                      onRemove={() => {}}
                    />
                  </li>
                ))}
              </ul>
            </div>
          }
          workspace={
            <div className="flex h-full items-center justify-center bg-void">
              <span className="font-body text-[length:var(--text-sm)] text-chrome-text-dim">
                workspace content
              </span>
            </div>
          }
          transport={
            <Transport
              control={DISABLED_TRANSPORT_CONTROL}
              volume={0.8}
              onVolumeChange={() => {}}
            />
          }
        />
      </div>
    </div>
  );
}

function SourcesPanelPreview() {
  const [sources, setSources] = useState<Array<Source>>(() => seedDemoSources(2));

  return (
    <div className="h-[180px] w-[240px] border border-chrome-border">
      <SourcesPanel sources={sources} onChange={(next) => setSources([...next])} />
    </div>
  );
}

function SourceRowPreview() {
  const [source, setSource] = useState<Source>(() =>
    createDefaultSource(0, { name: "Reference", audioFilePath: "demo/reference-mix.wav" }),
  );

  return (
    <div className="w-[360px] border border-chrome-border bg-chrome-surface">
      <SourceRow source={source} onChange={setSource} onRemove={() => {}} />
    </div>
  );
}

function ViewTabsPreview() {
  const [active, setActive] = useState<ViewId>("overlay");
  const [channelInput, setChannelInput] = useState<ChannelInput>("mono");
  const [syncEnabled, setSyncEnabled] = useState(false);

  return (
    <div className="w-[600px] border border-chrome-border">
      <ViewTabs
        active={active}
        onActiveChange={setActive}
        channelInput={channelInput}
        onChannelInputChange={setChannelInput}
        syncEnabled={syncEnabled}
        onSyncEnabledChange={setSyncEnabled}
        onUndo={() => {}}
        onRedo={() => {}}
        canUndo={false}
        canRedo={false}
      />
    </div>
  );
}

function TransportPreview() {
  // A non-disabled stub control showing the playing state + a populated scrub.
  // Time and duration are illustrative — drag-to-seek mutates `position` so the
  // scrub line moves under the cursor.
  const durationSec = 192; // 03:12
  const [position, setPosition] = useState(67);
  const [playing, setPlaying] = useState(true);
  // The `VolumeSlider` is controlled — the preview holds the volume locally.
  const [volume, setVolume] = useState(0.8);

  const control: TransportControl = {
    playing,
    positionSec: position,
    durationSec,
    onPlayToggle: () => {
      setPlaying((prev) => !prev);
    },
    onSeek: (sec) => {
      setPosition(Math.max(0, Math.min(durationSec, sec)));
    },
    // Populated readouts so the preview exercises the cursor / In / Out panel
    // rather than rendering an all-em-dash placeholder.
    cursorReadout: { time: "01:07.200", freq: "2.4 kHz", amp: "-18.6 dB" },
    selectionInSec: durationSec * 0.25,
    selectionOutSec: durationSec * 0.45,
    selectionInAmp: "-19.7 dB",
    selectionOutAmp: "-24.3 dB",
  };

  return (
    <div className="h-11 w-full border border-chrome-border bg-chrome-surface">
      <Transport control={control} volume={volume} onVolumeChange={setVolume} />
    </div>
  );
}

// --- View-container previews -------------------------------------------------

/**
 * Frame for the strip / view-container previews — every spectral demo lives in
 * an `overflow-hidden border` box at a fixed pixel size so the layout reads as
 * one example among many in a gallery rather than as the full app.
 */
function PreviewFrame({
  width,
  height,
  children,
}: {
  readonly width: number;
  readonly height: number;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden border border-chrome-border bg-void"
      style={{ width, height }}
    >
      {children}
    </div>
  );
}

function LoadingFrame({ width, height }: { readonly width: number; readonly height: number }) {
  return (
    <div
      className="flex items-center justify-center border border-chrome-border bg-void"
      style={{ width, height }}
    >
      <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">
        Loading audio...
      </span>
    </div>
  );
}

function SourceStripPreview({ audioData }: { readonly audioData: AudioData }) {
  const source = useMemo(
    () => createDefaultSource(0, { name: "Reference", audioFilePath: "demo/reference-mix.wav" }),
    [],
  );
  const startMs = audioData.durationMs * 0.3;
  const endMs = audioData.durationMs * 0.5;

  return (
    <PreviewFrame width={480} height={120}>
      <div className="relative h-full w-full">
        <SourceStrip
          source={source}
          audioData={audioData}
          startMs={startMs}
          endMs={endMs}
          fftSize={2048}
          hopOverlap={16}
          channelInput="mono"
        />
      </div>
    </PreviewFrame>
  );
}

interface ViewPreviewProps {
  readonly audioData: AudioData;
  readonly sources: ReadonlyArray<Source>;
}

/**
 * Build a `sourceId → AudioData` map keying the single demo buffer for every
 * source id — the workspace views take per-source audio after the desktop
 * migration's Phase 3.4 change. The demo has one shared buffer, so every
 * source resolves to it.
 */
function useSourceAudioMap(
  sources: ReadonlyArray<Source>,
  audioData: AudioData,
): ReadonlyMap<string, AudioData> {
  return useMemo(() => {
    const map = new Map<string, AudioData>();

    for (const source of sources) {
      map.set(source.id, audioData);
    }

    return map;
  }, [sources, audioData]);
}

function ViewFrame({
  width,
  height,
  children,
}: {
  readonly width: number;
  readonly height: number;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden border border-chrome-border"
      style={{ width, height }}
    >
      {children}
    </div>
  );
}

function OverlayViewPreview({ audioData, sources }: ViewPreviewProps) {
  const sourceAudio = useSourceAudioMap(sources, audioData);

  return (
    <ViewFrame width={600} height={320}>
      <OverlayView sources={sources} sourceAudio={sourceAudio} channelInput="mono" />
    </ViewFrame>
  );
}

function TimelineViewPreview({ audioData, sources }: ViewPreviewProps) {
  const sourceAudio = useSourceAudioMap(sources, audioData);

  return (
    <ViewFrame width={600} height={320}>
      <TimelineView sources={sources} sourceAudio={sourceAudio} channelInput="mono" />
    </ViewFrame>
  );
}

function SliderViewPreview({ audioData, sources }: ViewPreviewProps) {
  // SliderView shows the first two renderable sources. Slice to two so the
  // showcase doesn't depend on view-internal behaviour for a clean two-source
  // example.
  const twoSources = sources.slice(0, 2);
  const sourceAudio = useSourceAudioMap(twoSources, audioData);

  return (
    <ViewFrame width={600} height={320}>
      <SliderView sources={twoSources} sourceAudio={sourceAudio} channelInput="mono" />
    </ViewFrame>
  );
}

function DifferenceViewPreview({ audioData, sources }: ViewPreviewProps) {
  // DifferenceView renders a single derived strip — give it two sources so the
  // pseudo-source borrows a meaningful color anchor.
  const twoSources = sources.slice(0, 2);

  return (
    <ViewFrame width={600} height={320}>
      <DifferenceView
        sources={twoSources}
        derivedAudio={audioData}
        channelInput="mono"
      />
    </ViewFrame>
  );
}

function SumViewPreview({ audioData, sources }: ViewPreviewProps) {
  return (
    <ViewFrame width={600} height={320}>
      <SumView sources={sources} derivedAudio={audioData} channelInput="mono" />
    </ViewFrame>
  );
}

function FrequencyDistributionViewPreview({ audioData, sources }: ViewPreviewProps) {
  const sourceAudio = useSourceAudioMap(sources, audioData);

  return (
    <ViewFrame width={600} height={320}>
      <FrequencyDistributionView sources={sources} sourceAudio={sourceAudio} />
    </ViewFrame>
  );
}

function LoudnessViewPreview({ audioData, sources }: ViewPreviewProps) {
  const sourceAudio = useSourceAudioMap(sources, audioData);

  return (
    <ViewFrame width={600} height={320}>
      <LoudnessView sources={sources} sourceAudio={sourceAudio} />
    </ViewFrame>
  );
}

function CorrelationViewPreview({ audioData, sources }: ViewPreviewProps) {
  const sourceAudio = useSourceAudioMap(sources, audioData);

  return (
    <ViewFrame width={600} height={320}>
      <CorrelationView sources={sources} sourceAudio={sourceAudio} />
    </ViewFrame>
  );
}

function VectorscopeViewPreview({ audioData, sources }: ViewPreviewProps) {
  const sourceAudio = useSourceAudioMap(sources, audioData);

  return (
    <ViewFrame width={600} height={320}>
      <VectorscopeView sources={sources} sourceAudio={sourceAudio} />
    </ViewFrame>
  );
}

// --- Page --------------------------------------------------------------------

export function ShowcasePage() {
  // Load `/test-voice.wav` once at the page level (same pattern as App.tsx for
  // the Workspace tab) and thread the buffer into the spectral previews.
  const [audioData, setAudioData] = useState<AudioData | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadAudio("/test-voice.wav").then((data) => {
      if (cancelled) return;

      setAudioData(data);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Three demo sources for every view that takes a source list. Stable for the
  // lifetime of the page so colormaps / IDs don't churn across re-renders.
  const demoSources = useMemo(() => seedDemoSources(3), []);

  return (
    <div>
      <div className="flex flex-col gap-2 bg-void p-6">
        <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.15em] text-chrome-text-dim">Design System</span>
        <h1 className="font-display text-[length:var(--text-3xl)] font-bold leading-none tracking-tight text-chrome-text">
          SPECTRASCOPE
        </h1>
        <p className="font-body text-[length:var(--text-lg)] text-chrome-text-secondary">Spectral Audio Inspector</p>
        <span className="font-technical text-[length:var(--text-xs)] text-chrome-text-dim">v0.1.0</span>
      </div>

      <Section label="Workspace Shell">
        <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
          The persistent three-zone layout — sidebar with sources, center workspace switcher, media-only transport.
          Shown here at a small fixed size with stub content; the full-viewport composition lives in the Workspace demo tab.
        </p>
        <AppShellPreview />
      </Section>

      <Section label="Sources Panel">
        <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
          Per-source controls — hide/show (visual), mute/solo (audio), primary plus secondary color swatches, file path, inline-editable name.
          Controlled component; the parent owns the source list and applies the panel's `onChange` updates.
        </p>
        <SourcesPanelPreview />
      </Section>

      <Section label="Source Row">
        <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
          Atomic row used by SourcesPanel. Click either swatch to open the LayerColorPicker; click the name to inline-edit.
          The remove button is hover-revealed (chrome opacity, not data opacity).
        </p>
        <SourceRowPreview />
      </Section>

      <Section label="Layer Color + LayerColorPicker">
        <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
          Per-source two-point viridis ramp (void to secondary) plus the picker that edits both endpoints. Layer colors are user data, not design tokens —
          each source carries its own pair, applied to spectrogram, waveform, and loudness traces.
        </p>
        <LayerPaletteDemo />
      </Section>

      <Section label="View Tabs">
        <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
          The nine view tabs that drive the workspace switcher: Timeline / Overlay / Slider / Difference / Sum / Freq Dist / Loudness / Correlation / Vectorscope.
          Active state is a background-value shift; no underline, no animation on switch. The right-side cluster is global on every view —
          a cross-view Sync toggle, a Mono / Mid / Side channel-input selector, and undo / redo.
        </p>
        <ViewTabsPreview />
      </Section>

      <Section label="Source Strip">
        <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
          The atomic per-source visual unit — spectrogram plus waveform plus loudness rendered in one source's `layerColor`, no internal chrome.
          Used by Overlay, Timeline, Slider, Difference, and Sum. Compositing hooks (`opacity`, `clipPath`) belong to the parent view.
        </p>
        {audioData ? <SourceStripPreview audioData={audioData} /> : <LoadingFrame width={480} height={120} />}
      </Section>

      <Section label="View Containers">
        <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
          Each view container composes its own chrome (axes, minimap, display controls) around one or more `SourceStrip`s — or, for the chart views, its own SVG plot.
          Below is a small sample of each, rendered against three demo sources sharing one `test-voice.wav` buffer.
        </p>

        <div className="flex flex-col gap-6">
          <SubSection
            label="OverlayView"
            description="N visible sources z-stacked in one viewport, blended via `mix-blend-mode: lighten`. The documented exception to no-opacity-for-data — here the blend mode IS the data composition."
          >
            {audioData ? (
              <OverlayViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>

          <SubSection
            label="TimelineView"
            description="N visible sources stacked vertically — one row per source, each row is a SourceStrip in that source's layer color. Shared time axis and view chrome across the stack."
          >
            {audioData ? (
              <TimelineViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>

          <SubSection
            label="SliderView"
            description="Two visible sources A and B clipped against each other by a draggable Curtain handle. Left of the handle shows A; right shows B."
          >
            {audioData ? (
              <SliderViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>

          <SubSection
            label="DifferenceView"
            description="N inputs become N-1 derived A-B strips in a neutral layer color. Placeholder synthetic data this pass — real PCM arithmetic against AudioContext buffers is a follow-up."
          >
            {audioData ? (
              <DifferenceViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>

          <SubSection
            label="SumView"
            description="N inputs collapse into one derived sigma strip in a neutral layer color. Placeholder data; real sum-of-buffers arithmetic is a follow-up."
          >
            {audioData ? (
              <SumViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>

          <SubSection
            label="FrequencyDistributionView"
            description="One long-term-average-spectrum (LTAS) polyline per visible source on a single log-frequency / linear-dB chart. Synthetic curves this pass; real magnitude-spectrum extraction is a follow-up."
          >
            {audioData ? (
              <FrequencyDistributionViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>

          <SubSection
            label="LoudnessView"
            description="Three traces per visible source (LUFS / RMS / true-peak), all in that source's `layerColor.primary` differentiated by stroke weight, opacity, and dash pattern. Synthetic traces this pass."
          >
            {audioData ? (
              <LoudnessViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>

          <SubSection
            label="CorrelationView"
            description="One inter-channel correlation trace per visible source on a shared time axis, drawn in that source's `layerColor.primary`. The Y axis is the fixed +1..-1 correlation range: +1 mono-like, 0 decorrelated/wide, -1 inverted. The envelope is a real spectral-display scan product (config.stereo) — silence gaps break the polyline."
          >
            {audioData ? (
              <CorrelationViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>

          <SubSection
            label="VectorscopeView"
            description="A single shared (Side, Mid) density scope with every visible source's cloud overlaid on it. Each cloud is tinted in that source's layerColor.primary and the clouds are blended (mix-blend-mode: lighten) so they stay distinguishable; a legend keys names to tint. The scope is the largest square fitting the pane, centred, with the Mid/Side crosshair extending full-bleed to the container edges. GPU-rendered from the spectral-display vectorscope histogram (config.stereo); no transport (whole-clip aggregate)."
          >
            {audioData ? (
              <VectorscopeViewPreview audioData={audioData} sources={demoSources} />
            ) : (
              <LoadingFrame width={600} height={320} />
            )}
          </SubSection>
        </div>
      </Section>

      <Section label="Transport">
        <p className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
          Media-only — a cursor / In / Out readout panel on the left, the centered media-control cluster with speed and MM:SS / MM:SS timecode,
          and monitor volume on the right. Wired to the active view's `TransportControl`, not a global player; seeking is done on each view's
          time ruler, so the transport carries no scrub. Views without playback (e.g. Frequency Distribution) publish a control with `disabled: true`.
        </p>
        <TransportPreview />
      </Section>

      <Section label="Chrome Palette">
        <div className="flex">
          {CHROME.map((color) => {
            const isLight = parseInt(color.hex.slice(5, 7), 16) > 100;

            return (
              <div
                key={color.token}
                className="flex flex-1 flex-col justify-end p-3"
                style={{ backgroundColor: color.hex, minHeight: 72 }}
              >
                <span className={`font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] ${isLight ? "text-chrome-base" : "text-chrome-text-secondary"}`}>
                  {color.token}
                </span>
                <span className={`font-technical text-[length:var(--text-xs)] tabular-nums ${isLight ? "text-chrome-base" : "text-chrome-text-dim"}`}>
                  {color.hex}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section label="Chrome Accent">
        <div className="flex gap-6">
          {ACCENT.map((color) => (
            <div key={color.token} className="flex items-center gap-3">
              <div className="h-10 w-10" style={{ backgroundColor: color.hex }} />
              <div>
                <span className="block font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">{color.token}</span>
                <span className="block font-body text-[length:var(--text-base)] text-chrome-text">{color.label}</span>
                <span className="block font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{color.hex}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section label="State">
        <div className="flex gap-6">
          {STATE.map((color) => (
            <div key={color.token} className="flex items-center gap-3">
              <div className="h-10 w-10" style={{ backgroundColor: color.hex }} />
              <div>
                <span className="block font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">{color.token}</span>
                <span className="block font-body text-[length:var(--text-base)] text-chrome-text">{color.label}</span>
                <span className="block font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{color.hex}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Data Cursors & Selection">
        <div className="flex gap-6">
          {DATA_OVERLAY.map((color) => (
            <div key={color.token} className="flex items-center gap-3">
              <div className="h-10 w-10 bg-void" style={{ backgroundColor: color.hex }} />
              <div>
                <span className="block font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">{color.token}</span>
                <span className="block font-body text-[length:var(--text-base)] text-chrome-text">{color.label}</span>
                <span className="block font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{color.hex}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Edges">
        <div className="flex gap-6">
          {EDGE.map((color) => (
            <div key={color.token} className="flex items-center gap-3">
              <div className="flex items-center" style={{ width: 40 }}>
                <svg width={40} height={4}>
                  <line x1={0} y1={2} x2={40} y2={2} stroke={color.hex} strokeWidth={2} />
                </svg>
              </div>
              <div>
                <span className="block font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">{color.token}</span>
                <span className="block font-body text-[length:var(--text-base)] text-chrome-text">{color.label}</span>
                <span className="block font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{color.hex}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Typography">
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 flex flex-col gap-1">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Display — Bricolage Grotesque</span>
            <span className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">Hero text, logo, large display headings</span>
            <div className="mt-2 flex flex-col gap-2">
              <span className="font-display text-[length:var(--text-3xl)] font-bold leading-none tracking-tight text-chrome-text">Spectrascope</span>
              <span className="font-display text-[length:var(--text-2xl)] font-semibold leading-none tracking-tight text-chrome-text">Spectral Inspector</span>
              <span className="font-display text-[length:var(--text-xl)] font-medium leading-none text-chrome-text">Layered Display</span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Scale</span>
            {TYPE_SCALE.map((step) => (
              <div key={step.token} className="flex items-baseline justify-between">
                <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">{step.token}</span>
                <span className="font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{step.rem}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Body — Outfit</span>
            <span className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">Readable body text, descriptions, layer names</span>
            <div className="mt-2 flex flex-col gap-2">
              <span className="font-body text-[length:var(--text-xl)] text-chrome-text">Voice Denoise</span>
              <span className="font-body text-[length:var(--text-lg)] text-chrome-text">Reference mix vs candidate, freq-zoom 200 Hz to 8 kHz</span>
              <span className="font-body text-[length:var(--text-base)] text-chrome-text-secondary">Secondary content text at body sizes</span>
            </div>
          </div>

          <div className="col-span-2 flex flex-col gap-1">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Technical — JetBrains Mono</span>
            <span className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">Units, values, axes, labels, buttons, tags, timecodes — uppercase for labels/actions, case preserved for data</span>
            <div className="mt-2 flex flex-col gap-2">
              <span className="font-technical text-[length:var(--text-xl)] tabular-nums text-chrome-text">−24.5{" "}dB{"  "}00:01:32.450{"  "}44{" "}100{" "}Hz</span>
              <span className="font-technical text-[length:var(--text-base)] uppercase tracking-[0.06em] text-chrome-text-secondary">RENDER{"  "}BYPASS{"  "}EXPORT{"  "}DELETE</span>
            </div>
          </div>
        </div>
      </Section>

      <Section label="Spacing">
        <div className="flex flex-col gap-2">
          {SPACING_SCALE.map((step) => (
            <div key={step.token} className="flex items-center gap-4">
              <span className="w-28 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">{step.token}</span>
              <span className="w-16 font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{step.rem}</span>
              <span className="w-12 font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text-dim">{step.px}{" "}px</span>
              <div className="h-3 bg-primary" style={{ width: step.px }} />
              <span className="font-body text-[length:var(--text-xs)] text-chrome-text-secondary">{step.usage}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section label="Icons">
        <div className="flex flex-col gap-2">
          <span className="font-body text-[length:var(--text-xs)] text-chrome-text-secondary">
            Lucide icons rendered at 16{" "}px with a 1{" "}px stroke in chrome-text-secondary. No filled icons, no decorative color.
          </span>
          <div className="flex flex-wrap items-center gap-4">
            {ICONS.map(({ name, Component }) => (
              <div key={name} className="flex flex-col items-center gap-1">
                <Component size={16} strokeWidth={1} className="text-chrome-text-secondary" />
                <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section label="Inspection Primitives">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Curtain · two-layer strip</span>
            <MiniCurtainDemo />
            <span className="font-body text-[length:var(--text-xs)] text-chrome-text-secondary">
              Drag the handle to move the split. The active layer on each side is the one whose gradient is visible.
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Histogram · single layer</span>
            <MiniHistogramDemo />
            <span className="font-body text-[length:var(--text-xs)] text-chrome-text-secondary">
              Synthetic Gaussian magnitudes centered at −20{" "}dB. Bars render in layer primary; Y is normalized to peak.
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Sync · cursor across two views</span>
            <MiniSyncedPairDemo />
          </div>
        </div>
      </Section>

      <Section label="Components">
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Buttons</span>
            <div className="flex items-center gap-3">
              <Button variant="primary">Export</Button>
              <Button variant="secondary">Render</Button>
              <Button variant="ghost">Cancel</Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Inputs</span>
            <div className="flex flex-col gap-3">
              <Input label="Text" placeholder="Enter value…" />
              <Input type="number" label="Number" defaultValue="-24.5" />
              <div className="flex flex-col gap-1">
                <label className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-secondary">File</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    defaultValue="podcast-clean.wav"
                    className="flex-1 bg-void px-2 py-1.5 font-technical text-[length:var(--text-sm)] text-chrome-text outline-none focus:ring-1 focus:ring-secondary"
                  />
                  <Button variant="secondary">Browse</Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-dim">Menu</span>
            <div className="flex w-48 flex-col py-1 bg-chrome-raised">
              {["Noise Reduction", "EQ", "Compressor"].map((item, index) => (
                <div
                  key={item}
                  className={`mx-2 my-0.5 cursor-default font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text ${index === 1 ? "bg-interactive-hover" : ""}`}
                >
                  {item}
                </div>
              ))}
              <div className="mx-2 my-1 h-px bg-chrome-border-subtle" />
              {["Limiter", "Normalize"].map((item) => (
                <div key={item} className="mx-2 my-0.5 cursor-default font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section label="Controls">
        <ControlsDemo />
      </Section>
    </div>
  );
}
