import { identify } from "opshot";
import { scope, useMutableState } from "opshot/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { streamUrl } from "../../audio/streamAudioData";
import { resolveAudibleSources, useDerivedStreams } from "../../audio/useDerivedStreams";
import { usePlayer } from "../../audio/usePlayer";
import { useSourceStreams } from "../../audio/useSourceStreams";
import { automaticMeta } from "../../models/History";
import { AUDIO_FILE_EXTENSIONS } from "../../session/createSavedSession";
import { setDifference } from "../../session/utils/documentWrites";
import { relinkSource } from "../../session/utils/relinkSource";
import { AppShell } from "../../workspace/AppShell";
import { MeasurementSessionProvider } from "../../workspace/spectral/MeasurementSession";
import { ViewLoadingToast } from "../../workspace/spectral/ViewLoadingToast";
import { PreparingAudioContext } from "../../workspace/spectral/viewProgress";
import { Transport } from "../../workspace/Transport";
import { hasTransportViewControls, TransportViewControls } from "../../workspace/TransportViewControls";
import { normalizedSelectionOf } from "../../workspace/utils/selection";
import { ViewTopBar } from "../../workspace/ViewTopBar";
import { Workspace } from "../../workspace/Workspace";
import type { ExportControl } from "../../export/ExportControl";
import type { AppContext, SessionContext } from "../../models/Context";
import type { PlaybackState } from "../../models/State/Playback";
import type { Session } from "../../models/State/Session";
import type { TransportControl } from "../../workspace/Transport";

interface Props {
	readonly session: Session;
	readonly onExportControlChange: (control: ExportControl | null) => void;
	readonly context: AppContext;
}

const INITIAL_TRANSPORT_CONTROL: TransportControl = {
	disabled: false,
	readoutRows: [],
};

export const SessionTab = scope<Props>(({ session, onExportControlChange, context: appContext }: Props) => {
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
					const paths = await appContext.main.showOpenDialog({
						title: "Locate Audio",
						defaultPath: previousPath,
						filters: [{ name: "Audio", extensions: [...AUDIO_FILE_EXTENSIONS] }],
						properties: ["openFile"],
					});

					if (!paths?.[0]) return;

					const replacement = await relinkSource(appContext.main, source, paths[0]);
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
		[appContext.main, identify(document)],
	);

	const sources = document.sources;

	const activeView = navigation.activeView;

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
	const playback = useMutableState<PlaybackState>(
		() => ({
			positionSec: transport.positionSec,
			durationSec: playbackDurationSec,
			playing: false,
			error: null,
		}),
		{ emitOn: (flush) => requestAnimationFrame(flush) },
	);

	const selection = useMemo(
		() => normalizedSelectionOf(document.selection, sessionDurationMs),
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

	const derivedOverlayMessage = useMemo(() => {
		if (activeView === "sum") {
			const audible = resolveAudibleSources(sources).filter((source) => source.audioFilePath.length > 0);

			return audible.length < 1 ? "No audible sources" : null;
		}

		return null;
	}, [activeView, sources]);

	const preparing = useMemo(() => sources.some((source) => status.get(source.id) === "preparing"), [sources, status]);

	const playbackControls = usePlayer(
		playbackStreamUrl,
		playbackDurationSec,
		preparing || derivedPreparing,
		selection,
		playback,
		session,
	);

	const context = useMemo(
		(): SessionContext => ({ ...appContext, session, playback, playbackControls, sessionDurationMs }),
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
			identify(playback),
			playbackControls,
			sessionDurationMs,
		],
	);

	function onDefaultDifference(differenceA: string, differenceB: string): void {
		setDifference(differenceA, differenceB, automaticMeta, context);
	}

	const control = useMemo<TransportControl>(
		() => ({
			disabled: (transportControl.disabled ?? false) || playbackStreamUrl === null,
			readoutRows: transportControl.readoutRows,
		}),
		[transportControl, playbackStreamUrl],
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

	const playerError = playback.error;

	return (
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
										sourceAudio={sourceAudio}
										derivedAudio={derivedAudio}
										onTransportControlChange={setTransportControl}
										sourceStatus={status}
										sourceErrors={sourceErrors}
										onRetrySource={retrySource}
										onRelinkSource={onRelinkSource}
										context={context}
									/>
								</MeasurementSessionProvider>
							</PreparingAudioContext.Provider>
						</div>
					</div>
				}
				transport={
					<Transport
						control={control}
						sampleRate={activeStreamInfo?.sampleRate ?? 48000}
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
			{(derivedError ?? playerError) && (
				<div
					role="alert"
					className="absolute right-3 top-10 z-50 max-w-md bg-chrome-raised p-3 text-sm text-chrome-text"
				>
					<p>{derivedError ?? playerError}</p>
					<button
						type="button"
						className="mt-2 text-primary"
						onClick={derivedError ? retryDerived : playbackControls.onPlayToggle}
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
	);
});
