import { useEffect, useMemo, useState } from "react";
import {
  AppShell,
  SourcesPanel,
  SyncProvider,
  Transport,
  Workspace,
  createDefaultSource,
} from "@spectrascope/design-system";
import type {
  AudioData,
  MenuItem,
  Source,
  SyncState,
  TransportControl,
  ViewId,
} from "@spectrascope/design-system";
import { DemoTabBar } from "./DemoTabBar";
import { ShowcasePage } from "./pages/ShowcasePage";
import { HomePage } from "./pages/HomePage";
import { loadAudio } from "./data/audioLoader";

// The design-system-demo is a demonstration of the Spectrascope app GUI. Its
// own chrome (the top tab bar) is demo-only and is NOT part of the app — the
// real app has no equivalent. Each tab renders a page of the app being
// demonstrated:
//   - SHOWCASE: the component gallery (ShowcasePage)
//   - HOME: the app's home page (HomePage)
//   - WORKSPACE: the app's workspace shell (AppShell + SourcesPanel + Workspace + Transport)

const DEMO_PAGES = ["Showcase", "Home", "Workspace"] as const;

type DemoPage = (typeof DEMO_PAGES)[number];

// No-op handler for controlled design-system props the demo does not drive
// (undo/redo — a comparison-edit history that only the desktop app owns).
// Module-level so the reference is stable across renders.
const NOOP = () => {};

// Initial transport control, before the active view publishes its own. Not
// disabled — the default active view (Overlay) has playback, so the Transport
// should be present on first paint. The Frequency Distribution view is the
// only one that publishes `disabled: true`; that hides the Transport row
// entirely (the AppShell omits the row when given no transport).
const INITIAL_TRANSPORT_CONTROL: TransportControl = {
  disabled: false,
  playing: false,
  positionSec: 0,
  durationSec: 0,
  onPlayToggle: () => {},
  onSeek: () => {},
};

// App menu (File-style actions) and open-document tabs for the workspace's
// app-menu bar — the same `DemoTabBar` component the Home page uses.
const MENU_ITEMS: ReadonlyArray<MenuItem> = [
  { kind: "action", icon: "lucide:file-plus", label: "New Session", shortcut: "Ctrl+N" },
  { kind: "action", icon: "lucide:folder-open", label: "Open Session", shortcut: "Ctrl+O" },
  { kind: "action", icon: "lucide:save", label: "Save", shortcut: "Ctrl+S" },
  { kind: "action", icon: "lucide:save-all", label: "Save As…", shortcut: "Ctrl+Shift+S" },
  { kind: "separator" },
  { kind: "action", icon: "lucide:undo-2", label: "Undo", shortcut: "Ctrl+Z" },
  { kind: "action", icon: "lucide:redo-2", label: "Redo", shortcut: "Ctrl+Shift+Z" },
  { kind: "separator" },
  { kind: "action", icon: "lucide:settings", label: "Settings", shortcut: "Ctrl+," },
];

const WORKSPACE_TABS = [
  { id: "session", label: "vocal-comparison.spectra" },
] as const;

// Initial cross-view sync state for the demo's `SyncProvider`. The cursor /
// selection start empty; `timeRange` is a placeholder (the views derive their
// own window). The desktop app holds the equivalent in its comparison host.
const INITIAL_SYNC_STATE: SyncState = {
  cursor: null,
  selection: null,
  timeRange: { start: 0, end: 0 },
};

function seedSources(): Array<Source> {
  return [
    createDefaultSource(0, { name: "Source A", audioFilePath: "demo/source-a.wav" }),
    createDefaultSource(1, { name: "Source B", audioFilePath: "demo/source-b.wav" }),
    createDefaultSource(2, { name: "Source C", audioFilePath: "demo/source-c.wav" }),
  ];
}

function DemoPageNav({
  active,
  onChange,
}: {
  readonly active: DemoPage;
  readonly onChange: (page: DemoPage) => void;
}) {
  return (
    <nav className="flex h-9 shrink-0 items-center border-b border-chrome-border bg-chrome-surface px-2">
      <span className="mr-3 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">
        Demo
      </span>
      {DEMO_PAGES.map((page) => {
        const isActive = page === active;

        return (
          <button
            key={page}
            type="button"
            onClick={() => {
              onChange(page);
            }}
            className="px-2 py-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text"
          >
            {/* Button grammar — the outer button owns the padding / click
                target; the inner span owns the background chip and hugs the
                label with no padding of its own. Matches `Button`. */}
            <span
              className={`flex items-center ${
                isActive ? "bg-chrome-raised text-chrome-text" : ""
              }`}
            >
              {page}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function LoadingPane() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-void">
      <span className="font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-dim">
        Loading audio...
      </span>
    </div>
  );
}

function WorkspacePane({
  sources,
  setSources,
  audioData,
  transportControl,
  setTransportControl,
}: {
  readonly sources: Array<Source>;
  readonly setSources: (next: Array<Source>) => void;
  readonly audioData: AudioData | null;
  readonly transportControl: TransportControl;
  readonly setTransportControl: (control: TransportControl) => void;
}) {
  // The active view tab is now a controlled `Workspace` prop (the desktop app
  // owns it so it can pick the Sum vs Difference render). The demo just holds
  // it in local state — it has no comparison store.
  const [activeView, setActiveView] = useState<ViewId>("overlay");

  // Monitor volume — the `Transport`'s `VolumeSlider` is controlled. The
  // desktop app owns this in its comparison state and drives the player gain;
  // the demo just holds it locally, the same way it holds `activeView`.
  const [volume, setVolume] = useState(0.8);

  // Cross-view sync on/off — the `ViewTabs` Sync toggle is controlled (the
  // design system only provides the visual element). The demo holds it
  // locally; the desktop app owns it in its comparison host.
  const [syncEnabled, setSyncEnabled] = useState(false);

  // The demo loads one shared `test-voice.wav` buffer; the workspace shell now
  // takes per-source audio, so key that single buffer for every source id. The
  // `derivedAudio` (Sum / Difference) prop is the same buffer until Phase 5
  // wires the real ffmpeg render in the desktop app.
  const sourceAudio = useMemo<ReadonlyMap<string, AudioData>>(() => {
    const map = new Map<string, AudioData>();

    if (audioData) {
      for (const source of sources) {
        map.set(source.id, audioData);
      }
    }

    return map;
  }, [sources, audioData]);

  return (
    <div className="flex h-full flex-col">
      {/* App menu / open-document tabs bar — the application chrome that sits
          above the workspace shell. */}
      <DemoTabBar
        tabs={WORKSPACE_TABS}
        activeTabId="session"
        menuItems={MENU_ITEMS}
      />
      <div className="min-h-0 flex-1">
        <AppShell
          sidebar={
            <SourcesPanel
              sources={sources}
              onChange={(next) => setSources([...next])}
            />
          }
          workspace={
            audioData ? (
              // `SyncProvider` owns the shared cross-view cursor / selection;
              // `syncEnabled` gates whether the views read it. Mirrors the
              // desktop app's `Comparison.tsx`.
              <SyncProvider enabled={syncEnabled} initial={INITIAL_SYNC_STATE}>
                <Workspace
                  sources={sources}
                  sourceAudio={sourceAudio}
                  derivedAudio={audioData}
                  activeView={activeView}
                  onActiveViewChange={setActiveView}
                  syncEnabled={syncEnabled}
                  onSyncEnabledChange={setSyncEnabled}
                  // Undo/redo is comparison-edit history owned by the desktop
                  // app; the demo has no comparison store, so the buttons stay
                  // disabled with no-op handlers.
                  onUndo={NOOP}
                  onRedo={NOOP}
                  canUndo={false}
                  canRedo={false}
                  onTransportControlChange={setTransportControl}
                />
              </SyncProvider>
            ) : (
              <LoadingPane />
            )
          }
          transport={
            transportControl.disabled ? undefined : (
              <Transport
                control={transportControl}
                volume={volume}
                onVolumeChange={setVolume}
              />
            )
          }
        />
      </div>
    </div>
  );
}

export function App() {
  const [activePage, setActivePage] = useState<DemoPage>("Workspace");
  const [sources, setSources] = useState<Array<Source>>(seedSources);
  const [transportControl, setTransportControl] = useState<TransportControl>(
    INITIAL_TRANSPORT_CONTROL,
  );
  const [audioData, setAudioData] = useState<AudioData | null>(null);

  // Phase 4: load `/test-voice.wav` once at the App level and thread the
  // `AudioData` reader down through the Workspace. Mirrors the pre-deletion
  // SpectralPage's pattern (`archive/spectralpage-reference.tsx` lines ~337-349).
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

  return (
    <div className="flex h-screen w-screen flex-col bg-chrome-base text-chrome-text">
      <DemoPageNav active={activePage} onChange={setActivePage} />
      <main className="min-h-0 flex-1 overflow-hidden">
        {activePage === "Workspace" && (
          <WorkspacePane
            sources={sources}
            setSources={setSources}
            audioData={audioData}
            transportControl={transportControl}
            setTransportControl={setTransportControl}
          />
        )}
        {activePage === "Home" && (
          <div className="h-full overflow-auto">
            <HomePage />
          </div>
        )}
        {activePage === "Showcase" && (
          <div className="h-full overflow-auto bg-void">
            <ShowcasePage />
          </div>
        )}
      </main>
    </div>
  );
}
