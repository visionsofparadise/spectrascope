import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamUrl } from "../../audio/streamAudioData";
import { resolveAudibleSources, useDerivedStreams } from "../../audio/useDerivedStreams";
import { usePlayer } from "../../audio/usePlayer";
import { useSourceStreams } from "../../audio/useSourceStreams";
import { AUDIO_FILE_EXTENSIONS, createSourceFromFile, isBareAddSource } from "../../comparison/createComparison";
import { main } from "../../models/Main";
import { useComparisonHistory } from "../../state/useComparisonHistory";
import { AppShell } from "../../workspace/AppShell";
import { Sidebar } from "../../workspace/Sidebar";
import { SyncProvider } from "../../workspace/sync";
import { Transport } from "../../workspace/Transport";
import type { TransportControl } from "../../workspace/Transport";
import { Workspace } from "../../workspace/Workspace";
import { TransportViewControls } from "../../workspace/TransportViewControls";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "../../workspace/viewSettings";
import type { ViewId } from "../../workspace/Workspace";
import type { Source } from "../../workspace/source";
import type { HistoryControl } from "../../state/useComparisonHistory";
import type { AppContext } from "../../models/Context";
import type { Comparison, SourceState } from "../../models/State/App";
import type { SyncState } from "../../workspace/sync";
import type { ChannelInput } from "spectral-display";
import type { Snapshot } from "valtio/vanilla";

interface Props {
	readonly context: AppContext;
	/**
	 * The comparison this tab renders — a valtio snapshot resolved from the
	 * store (deeply readonly; the `SourcesPanel` mutates back through
	 * `appStore.mutate`).
	 */
	readonly comparison: Snapshot<Comparison>;
	/**
	 * Publish this comparison's undo/redo control up to the layout (which feeds
	 * the app bar). Called with the current `{ undo, redo, canUndo, canRedo }` on
	 * every change and with `null` on unmount.
	 */
	readonly onHistoryControlChange: (control: HistoryControl | null) => void;
}

const INITIAL_VOLUME = 0.8;

const INITIAL_SYNC_STATE: SyncState = {
	cursor: null,
	selection: null,
};

const INITIAL_TRANSPORT_CONTROL: TransportControl = {
	disabled: false,
	playing: false,
	positionSec: 0,
	durationSec: 0,
	onPlayToggle: () => {},
	onSeek: () => {},
};

function toSourceState(source: Source): SourceState {
	return {
		id: source.id,
		name: source.name,
		audioFilePath: source.audioFilePath,
		timelineOffsetMs: Math.max(0, source.timelineOffsetMs),
		layerColor: { primary: source.layerColor.primary, secondary: source.layerColor.secondary },
		visible: source.visible,
		muted: source.muted,
		soloed: source.soloed,
	};
}

export function ComparisonTab({ context, comparison, onHistoryControlChange }: Props) {
	const { app, appStore } = context;

	const [transportControl, setTransportControl] = useState<TransportControl>(INITIAL_TRANSPORT_CONTROL);

	const [volume, setVolume] = useState(INITIAL_VOLUME);

	const [syncEnabled, setSyncEnabled] = useState(false);

	const [viewSettings, setViewSettings] = useState(INITIAL_VIEW_CONTROL_SETTINGS);

	const sources: ReadonlyArray<Source> = comparison.sources;

	const activeView = comparison.activeView;

	const setCanonicalSampleRate = useCallback(
		(rate: number) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.canonicalSampleRate = rate;
			});
		},
		[app, appStore, comparison.id],
	);

	const setDifference = useCallback(
		(differenceA: string, differenceB: string) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.differenceA = differenceA;
				target.differenceB = differenceB;
			});
		},
		[app, appStore, comparison.id],
	);

	const { sourceAudio, prepared, status } = useSourceStreams(
		sources,
		comparison.canonicalSampleRate,
		setCanonicalSampleRate,
	);

	const { sumAudio, diffAudio, sumInfo, diffInfo } = useDerivedStreams(
		sources,
		prepared,
		comparison.differenceA,
		comparison.differenceB,
		setDifference,
	);

	const derivedAudio = activeView === "difference" ? diffAudio : sumAudio;

	const activeStreamInfo =
		activeView === "frequency-distribution" || activeView === "vectorscope"
			? null
			: activeView === "difference"
				? diffInfo
				: sumInfo;

	const playbackStreamUrl = activeStreamInfo === null ? null : streamUrl(activeStreamInfo.key, "wav");
	const playbackDurationSec = activeStreamInfo === null ? 0 : activeStreamInfo.durationMs / 1000;

	const derivedOverlayMessage = useMemo(() => {
		if (activeView === "sum") {
			const audible = resolveAudibleSources(sources).filter((source) => source.audioFilePath.length > 0);

			return audible.length < 1 ? "No audible sources" : null;
		}

		if (activeView === "difference") {
			const withPath = sources.filter((source) => source.audioFilePath.length > 0);

			return withPath.length < 2 ? "Difference needs at least two audible sources" : null;
		}

		return null;
	}, [activeView, sources]);

	const preparing = useMemo(() => sources.some((source) => status.get(source.id) === "preparing"), [sources, status]);


	const initialPositionRef = useRef(comparison.positionSec);

	const persistPosition = useCallback(
		(positionSec: number) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.positionSec = positionSec;
			});
		},
		[app, appStore, comparison.id],
	);

	const player = usePlayer(
		playbackStreamUrl,
		playbackDurationSec,
		initialPositionRef.current,
		persistPosition,
		volume,
	);

	const handleVolumeChange = useCallback(
		(next: number) => {
			setVolume(next);
			player.onVolumeChange(next);
		},
		[player],
	);

	const boundTransportControl = useMemo<TransportControl>(() => {
		if (transportControl.disabled || playbackStreamUrl === null) {
			return transportControl;
		}

		return {
			...transportControl,
			playing: player.playing,
			positionSec: player.positionSec,
			durationSec: player.durationSec > 0 ? player.durationSec : transportControl.durationSec,
			onPlayToggle: player.onPlayToggle,
			onSeek: player.onSeek,
		};
	}, [transportControl, playbackStreamUrl, player]);

	const appendSources = useCallback(
		(filePaths: ReadonlyArray<string>) => {
			if (filePaths.length === 0) return;

			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				const base = target.sources.length;

				for (const [offset, filePath] of filePaths.entries()) {
					target.sources.push(createSourceFromFile(filePath, base + offset));
				}
			});
		},
		[app, appStore, comparison.id],
	);

	const addSourcesFromDialog = useCallback(async () => {
		const filePaths = await main.showOpenDialog({
			filters: [{ name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
			properties: ["openFile", "multiSelections"],
		});

		if (!filePaths || filePaths.length === 0) return;

		appendSources(filePaths);
	}, [appendSources]);

	const handleSourceOffsetChange = useCallback(
		(sourceId: string, offsetMs: number) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				const source = target.sources.find((entry) => entry.id === sourceId);

				if (!source) return;

				source.timelineOffsetMs = Math.max(0, offsetMs);
			});
		},
		[app, appStore, comparison.id],
	);

	const handleSourcesChange = useCallback(
		(next: ReadonlyArray<Source>) => {
			if (isBareAddSource(sources, next)) {
				void addSourcesFromDialog();

				return;
			}

			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.sources = next.map(toSourceState);
			});
		},
		[app, appStore, comparison.id, sources, addSourcesFromDialog],
	);

	const handleActiveViewChange = useCallback(
		(view: ViewId) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.activeView = view;
			});
		},
		[app, appStore, comparison.id],
	);

	const handleChannelInputChange = useCallback(
		(next: ChannelInput) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.channelInput = next;
			});
		},
		[app, appStore, comparison.id],
	);


	const { undo, redo, canUndo, canRedo } = useComparisonHistory(comparison, app, appStore);

	useEffect(() => {
		onHistoryControlChange({ undo, redo, canUndo, canRedo });

		return () => {
			onHistoryControlChange(null);
		};
	}, [undo, redo, canUndo, canRedo, onHistoryControlChange]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey)) return;

			const key = event.key.toLowerCase();

			if (key !== "z" && key !== "y") return;

			const target = event.target;
			const isTextEntry =
				target instanceof HTMLElement &&
				(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

			if (isTextEntry) return;

			const isRedo = key === "y" || event.shiftKey;

			event.preventDefault();

			if (isRedo) {
				redo();
			} else {
				undo();
			}
		};

		window.addEventListener("keydown", onKeyDown);

		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [undo, redo]);

	return (
		<div className="relative flex flex-1 flex-col bg-void">
			<AppShell
				sidebar={
					<Sidebar
						activeView={activeView}
						onActiveViewChange={handleActiveViewChange}
						channelInput={comparison.channelInput}
						onChannelInputChange={handleChannelInputChange}
						canonicalSampleRate={comparison.canonicalSampleRate}
						onSampleRateChange={setCanonicalSampleRate}
						sources={sources}
						sourceStatus={status}
						onSourcesChange={handleSourcesChange}
					/>
				}
				workspace={
					<SyncProvider enabled={syncEnabled} initial={INITIAL_SYNC_STATE}>
						<Workspace
							sources={sources}
							sourceAudio={sourceAudio}
							derivedAudio={derivedAudio}
							activeView={activeView}
							channelInput={comparison.channelInput}
							settings={viewSettings}
							differenceA={comparison.differenceA}
							differenceB={comparison.differenceB}
							onDifferenceChange={setDifference}
							onSourceOffsetChange={handleSourceOffsetChange}
							onTransportControlChange={setTransportControl}
						/>
					</SyncProvider>
				}
				transport={
					boundTransportControl.disabled ? undefined : (
						<Transport
							control={boundTransportControl}
							volume={volume}
							onVolumeChange={handleVolumeChange}
							viewControls={
								<TransportViewControls
									activeView={activeView}
									settings={viewSettings}
									onSettingsChange={setViewSettings}
									syncEnabled={syncEnabled}
									onSyncEnabledChange={setSyncEnabled}
								/>
							}
						/>
					)
				}
			/>
			{preparing && (
				<div className="pointer-events-none absolute right-3 top-3 z-50 flex items-center gap-2 bg-chrome-raised px-2 py-1">
					<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
						Preparing audio…
					</span>
				</div>
			)}
			{derivedOverlayMessage !== null && (
				<div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
					<span className="bg-chrome-raised px-3 py-1.5 font-technical text-sm uppercase tracking-[0.06em] text-chrome-text-secondary">
						{derivedOverlayMessage}
					</span>
				</div>
			)}
		</div>
	);
}
