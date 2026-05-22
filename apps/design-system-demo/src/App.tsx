import { useEffect, useState } from "react";
import {
  AppShell,
  SourcesPanel,
  Transport,
  Workspace,
  createDefaultSource,
} from "@spectrascope/design-system";
import type {
  AudioData,
  MenuItem,
  Source,
  TransportControl,
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

function seedSources(): Array<Source> {
  return [
    createDefaultSource(0, { name: "Source A", filePath: "demo/source-a.wav", gainDb: 0 }),
    createDefaultSource(1, { name: "Source B", filePath: "demo/source-b.wav", gainDb: -3 }),
    createDefaultSource(2, { name: "Source C", filePath: "demo/source-c.wav", gainDb: -6 }),
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
              <Workspace
                sources={sources}
                audioData={audioData}
                onTransportControlChange={setTransportControl}
              />
            ) : (
              <LoadingPane />
            )
          }
          transport={
            transportControl.disabled ? undefined : (
              <Transport control={transportControl} />
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
