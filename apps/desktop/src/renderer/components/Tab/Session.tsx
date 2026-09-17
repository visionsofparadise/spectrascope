import { identify } from "opshot";
import { scope } from "opshot/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { streamUrl } from "../../audio/streamAudioData";
import { resolveAudibleSources, useDerivedStreams } from "../../audio/useDerivedStreams";
import { usePlayer } from "../../audio/usePlayer";
import { useSourceStreams } from "../../audio/useSourceStreams";
import { automaticMeta } from "../../models/History";
import { AUDIO_FILE_EXTENSIONS } from "../../session/createSavedSession";
import { pickAudioFiles } from "../../session/pickAudioFiles";
import { appendSources, removeSource, selectRange, setDifference } from "../../session/utils/documentWrites";
import { relinkSource } from "../../session/utils/relinkSource";
import { AppShell } from "../../workspace/AppShell";
import { WorkspacePlaybackProvider } from "../../workspace/playback";
import { MeasurementSessionProvider } from "../../workspace/spectral/MeasurementSession";
import { ViewLoadingToast } from "../../workspace/spectral/ViewLoadingToast";
import { PreparingAudioContext } from "../../workspace/spectral/viewProgress";
import { Transport } from "../../workspace/Transport";
import { hasTransportViewControls, TransportViewControls } from "../../workspace/TransportViewControls";
import { normalizeSelection } from "../../workspace/utils/selection";
import { ViewTopBar } from "../../workspace/ViewTopBar";
import { Workspace } from "../../workspace/Workspace";
import type { ExportControl } from "../../export/ExportControl";
import type { AppContext, SessionContext } from "../../models/Context";
import type { SourceState } from "../../models/State/App";
import type { Session } from "../../models/State/Session";
import type { TransportControl } from "../../workspace/Transport";
import type { ViewControlSettings } from "../../workspace/viewSettings";
import type { TextureVerticalRange } from "spectral-display";

interface Props {
	readonly session: Session;
	readonly onExportControlChange: (control: ExportControl | null) => void;
	readonly context: AppContext;
}

const INITIAL_TRANSPORT_CONTROL: TransportControl = {
	disabled: false,
	playing: false,
	positionSec: 0,
	durationSec: 0,
	onPlayToggle: () => {},
	onSeek: () => {},
	readoutRows: [],
};

export const SessionTab = scope<Props>(({ session, onExportControlChange, context: appContext }: Props) => {
	const context = useMemo(
		(): SessionContext => ({ ...appContext, session }),
		[
			identify(appContext.app),
			identify(appContext.sessionStatus),
			appContext.logger,
			appContext.main,
			appContext.mainEvents,
			appContext.queryClient,
			appContext.userDataPath,
			appContext.openSession,
			appContext.newSession,
			appContext.saveSession,
			appContext.closeSession,
			appContext.renameTab,
			appContext.removeRecentSession,
			identify(session),
		],
	);
	const { document, transport, navigation, file, history } = session;

	const [transportControl, setTransportControl] = useState<TransportControl>(INITIAL_TRANSPORT_CONTROL);

	const [relinkError, setRelinkError] = useState<string | null>(null);
	const onRelinkSource = useCallback(
		(sourceId: string): void => {
			void (async () => {
				setRelinkError(null);

				try {
					const source = document.sources.find((entry) => entry.id === sourceId);

					if (!source) return;

					const previousPath = source.audioFilePath;
					const paths = await context.main.showOpenDialog({
						title: "Locate Audio",
						defaultPath: previousPath,
						filters: [{ name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
						properties: ["openFile"],
					});

					if (!paths?.[0]) return;

					const replacement = await relinkSource(context.main, source, paths[0]);
					const target = document.sources.find((entry) => entry.id === sourceId);

					if (target?.audioFilePath === previousPath) {
						target.audioFilePath = replacement.audioFilePath;
						target.name = replacement.name;
					}
				} catch (cause) {
					setRelinkError(cause instanceof Error ? cause.message : String(cause));
				}
			})();
		},
		[context.main, identify(document)],
	);

	const sources = document.sources;

	const activeView = navigation.activeView;

	const onDefaultDifference = useCallback(
		(differenceA: string, differenceB: string) => setDifference(differenceA, differenceB, automaticMeta, context),
		[identify(document)],
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
	} = useDerivedStreams(sources, prepared, document.differenceA, document.differenceB, onDefaultDifference);

	const derivedAudio = activeView === "difference" ? diffAudio : sumAudio;

	const activeStreamInfo = activeView === "difference" ? diffInfo : sumInfo;

	const playbackStreamUrl = activeStreamInfo ? streamUrl(activeStreamInfo.key, "wav") : null;
	const playbackDurationSec = activeStreamInfo ? activeStreamInfo.durationMs / 1000 : 0;
	const sessionDurationMs = sources.reduce(
		(duration, source) => Math.max(duration, source.timelineOffsetMs + (sourceAudio.get(source.id)?.durationMs ?? 0)),
		playbackDurationSec * 1000,
	);
	const selection = useMemo(
		() =>
			document.selection
				? normalizeSelection(document.selection.start, document.selection.end, sessionDurationMs)
				: null,
		[document.selection, sessionDurationMs],
	);
	const exportStream = activeView === "difference" ? diffInfo : sumInfo;

	useEffect(() => {
		onExportControlChange({
			name: document.name,
			streamKey: exportStream?.key ?? null,
			streamLabel: activeView === "difference" ? "Difference of the selected A/B sources" : "Sum of audible sources",
			selection,
			protectedPaths: [
				...sources.map((source) => source.audioFilePath),
				...Array.from(prepared.values(), (source) => source.pcmPath),
				...(file.path ? [file.path] : []),
			],
		});

		return () => onExportControlChange(null);
	}, [document.name, file.path, sources, prepared, exportStream?.key, activeView, selection, onExportControlChange]);

	const handleSelectionChange = useCallback(
		(next: { start: number; end: number } | null) => selectRange(next, sessionDurationMs, context),
		[identify(document), identify(transport), sessionDurationMs],
	);

	const derivedOverlayMessage = useMemo(() => {
		if (activeView === "sum") {
			const audible = resolveAudibleSources(sources).filter((source) => source.audioFilePath.length > 0);

			return audible.length < 1 ? "No audible sources" : null;
		}

		return null;
	}, [activeView, sources]);

	const preparing = useMemo(() => sources.some((source) => status.get(source.id) === "preparing"), [sources, status]);

	const initialPositionRef = useRef(transport.positionSec);

	const persistPosition = useCallback(
		(positionSec: number) => {
			transport.positionSec = positionSec;
		},
		[identify(transport)],
	);

	const player = usePlayer(
		playbackStreamUrl,
		playbackDurationSec,
		initialPositionRef.current,
		persistPosition,
		document.volume,
		{
			playbackRate: transport.playbackRate,
			looping: transport.looping,
			selection,
			preparing: preparing || derivedPreparing,
		},
	);
	const workspacePlayback = useMemo(
		() => ({
			positionSec: player.positionSec,
			durationSec: Math.max(player.durationSec, sessionDurationMs / 1000),
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
			sessionDurationMs,
			selection,
			handleSelectionChange,
		],
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

	const handleAddSourceFiles = useCallback(
		(filePaths: ReadonlyArray<string>) => appendSources(filePaths, context),
		[identify(document)],
	);

	const addSourcesFromDialog = useCallback(async () => {
		const filePaths = await pickAudioFiles();

		if (filePaths) appendSources(filePaths, context);
	}, [identify(document)]);

	const handleSourceOffsetChange = useCallback(
		(sourceId: string, offsetMs: number) => {
			const source = document.sources.find((entry) => entry.id === sourceId);

			if (source) source.timelineOffsetMs = Math.max(0, offsetMs);
		},
		[identify(document)],
	);

	const handleSourceChange = useCallback(
		(sourceId: string, changes: Partial<SourceState>) => {
			const source = document.sources.find((entry) => entry.id === sourceId);

			if (source) Object.assign(source, changes);
		},
		[identify(document)],
	);

	const handleSourceRemove = useCallback((sourceId: string) => removeSource(sourceId, context), [identify(document)]);

	const settings = useMemo(
		(): ViewControlSettings => ({ ...document.renderSettings, frequencyRange: navigation.frequencyRange }),
		[document.renderSettings, navigation.frequencyRange],
	);

	const handleFrequencyRangeChange = useCallback(
		(frequencyRange: TextureVerticalRange) => {
			navigation.frequencyRange = { top: frequencyRange.top, bottom: frequencyRange.bottom };
		},
		[identify(navigation)],
	);

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
				history.redo();
			} else {
				history.undo();
			}
		};

		window.addEventListener("keydown", onKeyDown);

		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [identify(history)]);

	return (
		<WorkspacePlaybackProvider value={workspacePlayback}>
			<div className="relative flex min-h-0 flex-1 flex-col bg-void">
				<AppShell
					workspace={
						<div className="relative flex h-full min-h-0 flex-col bg-void">
							<ViewTopBar context={context} />
							<div className="relative min-h-0 flex-1 overflow-hidden px-4">
								{(preparing || derivedPreparing) && <ViewLoadingToast label="Preparing audio" />}
								<PreparingAudioContext.Provider value={preparing || derivedPreparing}>
									<MeasurementSessionProvider sessionId={session.id} sourceAudio={sourceAudio}>
										<Workspace
											sources={sources}
											sourceAudio={sourceAudio}
											derivedAudio={derivedAudio}
											activeView={activeView}
											channelInput={document.channelInput}
											settings={settings}
											onFrequencyRangeChange={handleFrequencyRangeChange}
											differenceA={document.differenceA}
											differenceB={document.differenceB}
											onSourceOffsetChange={handleSourceOffsetChange}
											onTransportControlChange={setTransportControl}
											sourceStatus={status}
											sourceErrors={sourceErrors}
											onRetrySource={retrySource}
											onRelinkSource={onRelinkSource}
											onSourceChange={handleSourceChange}
											onSourceRemove={handleSourceRemove}
											onAddSources={addSourcesFromDialog}
											onAddSourceFiles={handleAddSourceFiles}
										/>
									</MeasurementSessionProvider>
								</PreparingAudioContext.Provider>
							</div>
						</div>
					}
					transport={
						<Transport
							control={boundTransportControl}
							sampleRate={activeStreamInfo?.sampleRate ?? 48000}
							onMonitorVolumeChange={player.onVolumeChange}
							viewControls={
								hasTransportViewControls(activeView) ? <TransportViewControls context={context} /> : undefined
							}
							context={context}
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
});
