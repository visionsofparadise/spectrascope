import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamUrl } from "../../audio/streamAudioData";
import { resolveAudibleSources, useDerivedStreams } from "../../audio/useDerivedStreams";
import { usePlayer } from "../../audio/usePlayer";
import { useSourceStreams } from "../../audio/useSourceStreams";
import { createSourceFromFile, toSourceState } from "../../comparison/createComparison";
import { AUDIO_FILE_EXTENSIONS } from "../../comparison/createComparison";
import { pickAudioFiles } from "../../comparison/pickAudioFiles";
import { relinkSource } from "../../comparison/utils/relinkSource";
import { useComparisonHistory } from "../../state/useComparisonHistory";
import { AppShell } from "../../workspace/AppShell";
import { WorkspacePlaybackProvider } from "../../workspace/playback";
import { MeasurementSessionProvider } from "../../workspace/spectral/MeasurementSession";
import { ViewLoadingToast } from "../../workspace/spectral/ViewLoadingToast";
import { PreparingAudioContext } from "../../workspace/spectral/viewProgress";
import { SyncProvider } from "../../workspace/sync";
import { Transport } from "../../workspace/Transport";
import { hasTransportViewControls, TransportViewControls } from "../../workspace/TransportViewControls";
import { normalizeSelection } from "../../workspace/utils/selection";
import { ViewTopBar } from "../../workspace/ViewTopBar";
import { Workspace } from "../../workspace/Workspace";
import type { ExportControl } from "../../export/ExportControl";
import type { AppContext } from "../../models/Context";
import type { Comparison } from "../../models/State/App";
import type { HistoryControl } from "../../state/useComparisonHistory";
import type { Source } from "../../workspace/source";
import type { SyncState } from "../../workspace/sync";
import type { TransportControl } from "../../workspace/Transport";
import type { ViewControlSettings } from "../../workspace/viewSettings";
import type { ViewId } from "../../workspace/Workspace";
import type { ChannelInput } from "spectral-display";
import type { Snapshot } from "valtio/vanilla";

interface Props {
	readonly context: AppContext;
	readonly comparison: Snapshot<Comparison>;
	/**
	 * Publish this comparison's undo/redo control up to the layout (which feeds
	 * the app bar). Called with the current `{ undo, redo, canUndo, canRedo }` on
	 * every change and with `null` on unmount.
	 */
	readonly onHistoryControlChange: (control: HistoryControl | null) => void;
	readonly onExportControlChange: (control: ExportControl | null) => void;
}

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
	readoutRows: [],
};

export function ComparisonTab({ context, comparison, onHistoryControlChange, onExportControlChange }: Props) {
	const { app, appStore } = context;

	const [transportControl, setTransportControl] = useState<TransportControl>(INITIAL_TRANSPORT_CONTROL);

	const { volume, playbackRate, looping, syncEnabled, viewSettings } = comparison;
	const [relinkError, setRelinkError] = useState<string | null>(null);
	const updateSettings = useCallback(
		(changes: Partial<Comparison>): void => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (target) Object.assign(target, changes);
			});
		},
		[app, appStore, comparison.id],
	);
	const setVolume = useCallback((value: number) => updateSettings({ volume: value }), [updateSettings]);
	const setPlaybackRate = useCallback((value: number) => updateSettings({ playbackRate: value }), [updateSettings]);
	const setLooping = useCallback((value: boolean) => updateSettings({ looping: value }), [updateSettings]);
	const setSyncEnabled = useCallback((value: boolean) => updateSettings({ syncEnabled: value }), [updateSettings]);
	const setViewSettings = useCallback(
		(value: ViewControlSettings) => updateSettings({ viewSettings: value }),
		[updateSettings],
	);
	const changeViewSettings = useCallback(
		(changes: Partial<ViewControlSettings>) => setViewSettings({ ...viewSettings, ...changes }),
		[setViewSettings, viewSettings],
	);
	const onRelinkSource = useCallback(
		(sourceId: string): void => {
			void (async () => {
				setRelinkError(null);

				try {
					const source = comparison.sources.find((entry) => entry.id === sourceId);

					if (!source) return;

					const paths = await context.main.showOpenDialog({
						title: "Locate Audio",
						defaultPath: source.audioFilePath,
						filters: [{ name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
						properties: ["openFile"],
					});

					if (!paths?.[0]) return;

					const replacement = await relinkSource(context.main, source, paths[0]);

					appStore.mutate(app, (proxy) => {
						const targetComparison = proxy.comparisons.find((entry) => entry.id === comparison.id);
						const target = targetComparison?.sources.find((entry) => entry.id === sourceId);

						if (target?.audioFilePath === source.audioFilePath) {
							target.audioFilePath = replacement.audioFilePath;
							target.name = replacement.name;
						}
					});
				} catch (cause) {
					setRelinkError(cause instanceof Error ? cause.message : String(cause));
				}
			})();
		},
		[comparison, context.main, appStore, app],
	);

	const sources: ReadonlyArray<Source> = comparison.sources;

	const activeView = comparison.activeView;

	const setDifference = useCallback(
		(differenceA: string | null, differenceB: string | null) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.differenceA = differenceA;
				target.differenceB = differenceB;
			});
		},
		[app, appStore, comparison.id],
	);

	const { sourceAudio, prepared, status, errors: sourceErrors, retrySource } = useSourceStreams(sources);

	const {
		sumAudio,
		diffAudio,
		sumInfo,
		diffInfo,
		preparing: derivedPreparing,
		error: derivedError,
		retry: retryDerived,
	} = useDerivedStreams(sources, prepared, comparison.differenceA, comparison.differenceB, setDifference);

	const derivedAudio = activeView === "difference" ? diffAudio : sumAudio;

	const activeStreamInfo = activeView === "difference" ? diffInfo : sumInfo;

	const playbackStreamUrl = activeStreamInfo ? streamUrl(activeStreamInfo.key, "wav") : null;
	const playbackDurationSec = activeStreamInfo ? activeStreamInfo.durationMs / 1000 : 0;
	const comparisonDurationMs = sources.reduce(
		(duration, source) => Math.max(duration, source.timelineOffsetMs + (sourceAudio.get(source.id)?.durationMs ?? 0)),
		playbackDurationSec * 1000,
	);
	const selection = useMemo(
		() =>
			comparison.selection
				? normalizeSelection(comparison.selection.start, comparison.selection.end, comparisonDurationMs)
				: null,
		[comparison.selection, comparisonDurationMs],
	);
	const exportStream = activeView === "difference" ? diffInfo : sumInfo;

	useEffect(() => {
		onExportControlChange({
			name: comparison.name,
			streamKey: exportStream?.key ?? null,
			streamLabel: activeView === "difference" ? "Difference of the selected A/B sources" : "Sum of audible sources",
			selection,
			protectedPaths: [
				...sources.map((source) => source.audioFilePath),
				...Array.from(prepared.values(), (source) => source.pcmPath),
				...(comparison.sessionFilePath ? [comparison.sessionFilePath] : []),
			],
		});

		return () => onExportControlChange(null);
	}, [
		comparison.name,
		comparison.sessionFilePath,
		sources,
		prepared,
		exportStream?.key,
		activeView,
		selection,
		onExportControlChange,
	]);

	const handleSelectionChange = useCallback(
		(next: { start: number; end: number } | null) => {
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (target) {
					target.selection = next ? normalizeSelection(next.start, next.end, comparisonDurationMs) : null;

					if (target.selection) target.looping = true;
				}
			});
		},
		[app, appStore, comparison.id, comparisonDurationMs],
	);

	const derivedOverlayMessage = useMemo(() => {
		if (activeView === "sum") {
			const audible = resolveAudibleSources(sources).filter((source) => source.audioFilePath.length > 0);

			return audible.length < 1 ? "No audible sources" : null;
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
		{ playbackRate, looping, selection, preparing: preparing || derivedPreparing },
	);
	const workspacePlayback = useMemo(
		() => ({
			positionSec: player.positionSec,
			durationSec: Math.max(player.durationSec, comparisonDurationMs / 1000),
			playing: player.playing,
			onPlayToggle: player.onPlayToggle,
			onSeek: player.onSeek,
			selection,
			onSelectionChange: handleSelectionChange,
		}),
		[
			player.positionSec,
			player.durationSec,
			player.playing,
			player.onPlayToggle,
			player.onSeek,
			comparisonDurationMs,
			selection,
			handleSelectionChange,
		],
	);

	const handleVolumeChange = useCallback(
		(next: number) => {
			setVolume(next);
			player.onVolumeChange(next);
		},
		[player, setVolume],
	);

	const boundTransportControl = useMemo<TransportControl>(
		() => ({
			...transportControl,
			disabled: (transportControl.disabled ?? false) || playbackStreamUrl === null,
			playing: player.playing,
			positionSec: player.positionSec,
			durationSec: player.durationSec > 0 ? player.durationSec : transportControl.durationSec,
			onPlayToggle: player.onPlayToggle,
			onSeek: player.onSeek,
		}),
		[transportControl, playbackStreamUrl, player],
	);

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
		const filePaths = await pickAudioFiles();

		if (filePaths) appendSources(filePaths);
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
			appStore.mutate(app, (proxy) => {
				const target = proxy.comparisons.find((entry) => entry.id === comparison.id);

				if (!target) return;

				target.sources = next.map(toSourceState);

				if (!target.sources.some((source) => source.id === target.differenceA)) target.differenceA = null;

				if (!target.sources.some((source) => source.id === target.differenceB)) target.differenceB = null;
			});
		},
		[app, appStore, comparison.id],
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
		<WorkspacePlaybackProvider value={workspacePlayback}>
			<div className="relative flex min-h-0 flex-1 flex-col bg-void">
				<AppShell
					workspace={
						<div className="relative flex h-full min-h-0 flex-col bg-void">
							<ViewTopBar
								activeView={activeView}
								onActiveViewChange={handleActiveViewChange}
								channelInput={comparison.channelInput}
								onChannelInputChange={handleChannelInputChange}
								settings={viewSettings}
								onSettingsChange={changeViewSettings}
								sources={sources}
								differenceA={comparison.differenceA}
								differenceB={comparison.differenceB}
								onDifferenceChange={setDifference}
								syncEnabled={syncEnabled}
								onSyncEnabledChange={setSyncEnabled}
							/>
							<div className="relative min-h-0 flex-1 overflow-hidden px-4">
								{(preparing || derivedPreparing) && <ViewLoadingToast label="Preparing audio" />}
								<PreparingAudioContext.Provider value={preparing || derivedPreparing}>
									<MeasurementSessionProvider sessionId={comparison.id} sourceAudio={sourceAudio}>
										<SyncProvider enabled={syncEnabled} initial={INITIAL_SYNC_STATE}>
											<Workspace
												sources={sources}
												sourceAudio={sourceAudio}
												derivedAudio={derivedAudio}
												activeView={activeView}
												channelInput={comparison.channelInput}
												settings={viewSettings}
												onFrequencyRangeChange={(frequencyRange) =>
													setViewSettings({ ...viewSettings, frequencyRange })
												}
												differenceA={comparison.differenceA}
												differenceB={comparison.differenceB}
												onSourceOffsetChange={handleSourceOffsetChange}
												onTransportControlChange={setTransportControl}
												sourceStatus={status}
												sourceErrors={sourceErrors}
												onRetrySource={retrySource}
												onRelinkSource={onRelinkSource}
												onSourcesChange={handleSourcesChange}
												onAddSources={addSourcesFromDialog}
												onAddSourceFiles={appendSources}
											/>
										</SyncProvider>
									</MeasurementSessionProvider>
								</PreparingAudioContext.Provider>
							</div>
						</div>
					}
					transport={
						<Transport
							control={boundTransportControl}
							playbackRate={playbackRate}
							onPlaybackRateChange={setPlaybackRate}
							looping={looping}
							onLoopingChange={setLooping}
							sampleRate={activeStreamInfo?.sampleRate ?? 48000}
							volume={volume}
							onVolumeChange={handleVolumeChange}
							viewControls={
								hasTransportViewControls(activeView) ? (
									<TransportViewControls
										activeView={activeView}
										settings={viewSettings}
										onSettingsChange={setViewSettings}
									/>
								) : undefined
							}
						/>
					}
				/>
				{relinkError && (
					<div
						role="alert"
						className="absolute right-3 top-20 z-50 max-w-md bg-chrome-raised p-3 text-sm text-chrome-text"
					>
						<p>{relinkError}</p>
						<button type="button" onClick={() => setRelinkError(null)}>
							Dismiss
						</button>
					</div>
				)}
				{(derivedError ?? player.error) && (
					<div
						role="alert"
						className="absolute right-3 top-10 z-50 max-w-md bg-chrome-raised p-3 text-sm text-chrome-text"
					>
						<p>{derivedError ?? player.error}</p>
						<button
							type="button"
							className="mt-2 text-primary"
							onClick={derivedError ? retryDerived : player.onPlayToggle}
						>
							Retry
						</button>
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
		</WorkspacePlaybackProvider>
	);
}
