import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AUDIO_FILE_EXTENSIONS } from "../../comparison/createComparison";
import { Button } from "../../components/Button";
import { main } from "../../models/Main";
import { SourceRender } from "../SourceRender";
import { TimeRuler } from "../spectral/Axes";
import { CursorLine, CursorSurface } from "../spectral/CursorSurface";
import { GridOverlay } from "../spectral/GridOverlay";
import { MinimapDisplay, minimapLayersOf } from "../spectral/MinimapDisplay";
import { trackPointerDrag } from "../spectral/pointerDrag";
import { ScrollTrack } from "../spectral/ScrollTrack";
import { useWaveformReadouts } from "../spectral/useWaveformReadouts";
import { ViewLoadingToast } from "../spectral/ViewLoadingToast";
import { ViewProgressProvider, ViewProgressToast } from "../spectral/viewProgress";
import { useTransportPlayback } from "../spectral/viewScaffold";
import { EMPTY_SYNC_STATE, useViewSync } from "../sync";
import { TimelineTrackHeader } from "../TimelineTrackHeader";
import { useTimeViewport } from "../useTimeViewport";
import { panAxisRange } from "../utils/axisRange";
import { placeAudioOnTimeline } from "../utils/placeAudioOnTimeline";
import { clipWindowIntersection, computeTimelineExtent } from "./timelineExtent";
import { resolveVisibleSourceAudio } from "./viewAudio";
import { timeToFraction } from "./viewCursor";
import type { Source } from "../source";
import type { SourceRenderCursorReadout } from "../SourceRender";
import type { TimelineDrag } from "./timelineExtent";
import type { SourceStreamStatus } from "../../audio/useSourceStreams";
import type { TimelineOffsetHandle } from "../TimelineTrackHeader";
import type { SourceManagementProps } from "./viewProps";
import type { AudioData } from "../spectral/types";
import type { DisplayedWaveform } from "../spectral/useWaveformReadouts";
import type { TransportControl } from "../Transport";
import type { AxisRange } from "../utils/axisRange";
import type { ViewControlSettings } from "../viewSettings";
import type { FrequencyScale } from "spectral-display";
import type { ChannelInput } from "spectral-display";

const TRACK_MIN_SPAN = 1 / 4;
const TRACK_EDGE_EPSILON = 1e-9;
const SINGLE_TRACK_HEIGHT = 0.8;
const MIN_TRACK_HEIGHT = 0.1;
const ADD_SOURCE_ROW_HEIGHT = "3.5rem";

export function trackHeightOf(count: number): number {
	return count <= 1 ? SINGLE_TRACK_HEIGHT : Math.max(1 / count, MIN_TRACK_HEIGHT);
}

export function defaultTrackRangeOf(count: number): AxisRange {
	return { start: 0, end: count > 0 ? Math.min(1, 1 / (count * trackHeightOf(count))) : 1 };
}

export function trackStackShareOf(count: number): number {
	return count > 0 ? Math.min(trackHeightOf(count), 1 / count) : 1;
}

export function trackHeightStyleOf(count: number): string {
	return `calc(${trackStackShareOf(count)} * (100% - ${ADD_SOURCE_ROW_HEIGHT}))`;
}

export function droppedAudioFilePathsOf<T>(files: ReadonlyArray<T>, pathForFile: (file: T) => string): Array<string> {
	const extensions: ReadonlyArray<string> = AUDIO_FILE_EXTENSIONS;

	return files
		.map(pathForFile)
		.filter((filePath) => extensions.includes(filePath.split(".").pop()?.toLowerCase() ?? ""));
}

export function trackStackStyleOf(range: AxisRange): { readonly height: string; readonly top: string } {
	const span = range.end - range.start;

	return { height: `${100 / span}%`, top: `${(-range.start / span) * 100}%` };
}

export function visibleTracksOf(range: AxisRange, count: number): { readonly first: number; readonly last: number } {
	const share = trackStackShareOf(count);
	const first = Math.min(count, Math.floor(range.start / share + TRACK_EDGE_EPSILON) + 1);
	const last = Math.max(first, Math.min(count, Math.ceil(range.end / share - TRACK_EDGE_EPSILON)));

	return { first, last };
}

export function trackHandleTopOf(range: AxisRange, index: number, count: number): string {
	const hiddenFraction = Math.max(0, range.start / trackStackShareOf(count) - index);

	return `clamp(0px, ${hiddenFraction * 100}%, calc(100% - 1.25rem))`;
}

function TimelineTrack({
	source,
	audioData,
	status,
	error,
	height,
	offsetMs,
	windowStartMs,
	windowEndMs,
	committedStartMs,
	committedEndMs,
	freezeCompute,
	extentEndMs,
	frequencyScale,
	spectrogramSampling,
	spectrogramColormap,
	fftSize,
	hopOverlap,
	channelInput,
	waveformOpacity,
	spectrogramOpacity,
	draggable,
	dragging,
	handleTop,
	onCursorMove,
	onDisplayedResultChange,
	onDragMove,
	onCommit,
	onSourceChange,
	onRetry,
	onRelink,
	onRemove,
}: {
	readonly source: Source;
	readonly audioData: AudioData | undefined;
	readonly status: SourceStreamStatus | undefined;
	readonly error: string | undefined;
	readonly height: string;
	/** This source's effective placement on the shared timeline, in ms (≥ 0) —
	 *  the stored offset between drags, the live drag offset during one. */
	readonly offsetMs: number;
	readonly windowStartMs: number;
	readonly windowEndMs: number;
	readonly committedStartMs: number;
	readonly committedEndMs: number;
	readonly freezeCompute: boolean;
	readonly extentEndMs: number;
	readonly frequencyScale: FrequencyScale;
	readonly spectrogramSampling: ViewControlSettings["spectrogramSampling"];
	readonly spectrogramColormap: ViewControlSettings["spectrogramColormap"];
	readonly fftSize: number;
	readonly hopOverlap: number;
	readonly channelInput: ChannelInput;
	readonly waveformOpacity: number;
	readonly spectrogramOpacity: number;
	readonly draggable: boolean;
	readonly dragging: boolean;
	readonly handleTop: string;
	readonly onCursorMove: (readout: SourceRenderCursorReadout) => void;
	readonly onDisplayedResultChange: (sourceId: string, displayed: DisplayedWaveform | null) => void;
	readonly onDragMove: (offsetMs: number) => void;
	/** Emits the final (floored ≥ 0) offset — once per drag (pointer-up) and once
	 *  per arrow-key nudge. */
	readonly onCommit: (offsetMs: number) => void;
	readonly onSourceChange?: (next: Source) => void;
	readonly onRetry?: () => void;
	readonly onRelink?: () => void;
	readonly onRemove?: () => void;
}) {
	const trackRef = useRef<HTMLDivElement>(null);

	const durationMs = audioData?.durationMs ?? 0;

	const onDragMoveRef = useRef(onDragMove);
	const onCommitRef = useRef(onCommit);
	const windowStartRef = useRef(windowStartMs);
	const windowSpanRef = useRef(windowEndMs - windowStartMs);

	useEffect(() => {
		onDragMoveRef.current = onDragMove;
	}, [onDragMove]);
	useEffect(() => {
		onCommitRef.current = onCommit;
	}, [onCommit]);
	useEffect(() => {
		windowStartRef.current = windowStartMs;
		windowSpanRef.current = windowEndMs - windowStartMs;
	}, [windowStartMs, windowEndMs]);

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			if (!draggable) return;

			event.preventDefault();
			event.stopPropagation();

			const track = trackRef.current;

			if (!track) return;

			const rect = track.getBoundingClientRect();

			if (rect.width <= 0) return;

			const grabMs = windowStartRef.current + ((event.clientX - rect.left) / rect.width) * windowSpanRef.current;
			const grabWithinClipMs = grabMs - offsetMs;

			const offsetFromClientX = (clientX: number) => {
				const pointerMs = windowStartRef.current + ((clientX - rect.left) / rect.width) * windowSpanRef.current;

				return Math.max(0, pointerMs - grabWithinClipMs);
			};

			trackPointerDrag(
				(clientX) => {
					onDragMoveRef.current(offsetFromClientX(clientX));
				},
				(clientX) => {
					onCommitRef.current(offsetFromClientX(clientX));
				},
			);
		},
		[draggable, offsetMs],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLButtonElement>) => {
			if (!draggable) return;

			const fine = event.shiftKey ? 10 : 100;
			let next: number | null = null;

			if (event.key === "ArrowLeft") next = offsetMs - fine;
			else if (event.key === "ArrowRight") next = offsetMs + fine;
			else if (event.key === "Home") next = 0;
			else if (event.key === "End") next = extentEndMs - durationMs;

			if (next === null) return;

			event.preventDefault();
			onCommit(Math.max(0, next));
		},
		[draggable, offsetMs, extentEndMs, durationMs, onCommit],
	);

	const windowSpanMs = windowEndMs - windowStartMs;
	const span = windowSpanMs > 0 ? windowSpanMs : 1;
	const liveWindow = clipWindowIntersection(offsetMs, durationMs, { startMs: windowStartMs, endMs: windowEndMs });
	const computeWindow = clipWindowIntersection(source.timelineOffsetMs, durationMs, {
		startMs: committedStartMs,
		endMs: committedEndMs,
	});
	const leftPct = liveWindow ? ((offsetMs + liveWindow.startMs - windowStartMs) / span) * 100 : 0;
	const widthPct = liveWindow ? ((liveWindow.endMs - liveWindow.startMs) / span) * 100 : 0;
	const offsetHandle: TimelineOffsetHandle | undefined =
		draggable && audioData
			? { valueMaxMs: extentEndMs, onPointerDown: handlePointerDown, onKeyDown: handleKeyDown }
			: undefined;

	return (
		<ViewProgressProvider>
			<div ref={trackRef} className="relative shrink-0 overflow-hidden" style={{ height }}>
				{audioData && source.visible && liveWindow && (
					<div className="absolute inset-y-0" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
						{computeWindow && (
							<SourceRender
								onDisplayedResultChange={onDisplayedResultChange}
								source={source}
								audioData={audioData}
								startMs={computeWindow.startMs}
								endMs={computeWindow.endMs}
								liveStartMs={liveWindow.startMs}
								liveEndMs={liveWindow.endMs}
								readoutTimeOffsetMs={offsetMs}
								freezeCompute={freezeCompute}
								frequencyScale={frequencyScale}
								spectrogramSampling={spectrogramSampling}
								spectrogramColormap={spectrogramColormap}
								fftSize={fftSize}
								hopOverlap={hopOverlap}
								channelInput={channelInput}
								waveformOpacity={waveformOpacity}
								spectrogramOpacity={spectrogramOpacity}
								onCursorMove={onCursorMove}
							/>
						)}
						{liveWindow.startMs === 0 && (
							<div
								aria-hidden
								className={`pointer-events-none absolute inset-y-0 left-0 w-0.5 ${
									dragging ? "bg-primary" : "bg-chrome-text/60"
								}`}
							/>
						)}
					</div>
				)}
				{status === "error" && (
					<div
						role="alert"
						className="absolute inset-x-0 top-6 flex flex-col items-start gap-1 px-1 text-xs text-state-error"
					>
						<span className="break-words">{error ?? "Audio preparation failed."}</span>
						{onRelink && (
							<button type="button" className="text-primary" onClick={onRelink}>
								Locate audio…
							</button>
						)}
						{onRetry && source.audioFilePath.length > 0 && (
							<button type="button" className="underline focus-visible:outline" onClick={onRetry}>
								Retry source
							</button>
						)}
					</div>
				)}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-px bg-chrome-border-subtle"
				/>
				<div className="pointer-events-none absolute right-0" style={{ top: handleTop }}>
					{status === "preparing" ? (
						<ViewLoadingToast label="Preparing audio" color={source.layerColor.primary} />
					) : (
						<ViewProgressToast color={source.layerColor.primary} />
					)}
				</div>
				<TimelineTrackHeader
					source={source}
					top={handleTop}
					offsetMs={offsetMs}
					offsetHandle={offsetHandle}
					onSourceChange={onSourceChange}
					onRelink={onRelink}
					onRemove={onRemove}
				/>
			</div>
		</ViewProgressProvider>
	);
}

interface TimelineViewProps extends SourceManagementProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly channelInput: ChannelInput;
	readonly settings: ViewControlSettings;
	/**
	 * Emitted when a source's clip is dragged (or keyboard-nudged) on the
	 * timeline — `(sourceId, offsetMs)` with `offsetMs ≥ 0`. Controlled,
	 * props-in / callbacks-out: the view owns no placement state, it renders
	 * position from each `Source.timelineOffsetMs` and reports drag results out.
	 * When omitted, the timeline still lays strips out by offset but the drag
	 * affordance is not rendered (the component-showcase case).
	 */
	readonly onSourceOffsetChange?: (sourceId: string, offsetMs: number) => void;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

export function TimelineView({
	sources,
	sourceAudio,
	channelInput,
	settings,
	onSourceOffsetChange,
	onTransportControlChange,
	sourceStatus,
	sourceErrors,
	onRetrySource,
	onRelinkSource,
	onSourcesChange,
	onAddSources,
	onAddSourceFiles,
}: TimelineViewProps) {
	const readouts = useWaveformReadouts();
	const viewSync = useViewSync("timeline", EMPTY_SYNC_STATE);
	const [drag, setDrag] = useState<TimelineDrag | null>(null);

	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	const extent = useMemo(
		() =>
			computeTimelineExtent(
				renderableSources.map(({ source, audioData }) => ({
					id: source.id,
					offsetMs: source.timelineOffsetMs,
					durationMs: audioData.durationMs,
				})),
				drag,
			),
		[renderableSources, drag],
	);
	const minimapDurationMs = useMemo(
		() =>
			computeTimelineExtent(
				renderableSources.map(({ source, audioData }) => ({
					id: source.id,
					offsetMs: source.timelineOffsetMs,
					durationMs: audioData.durationMs,
				})),
				null,
			).endMs,
		[renderableSources],
	);

	const highestSampleRate =
		renderableSources.reduce((highest, entry) => Math.max(highest, entry.audioData.sampleRate), 0) || 48000;
	const viewport = useTimeViewport(extent.startMs, extent.endMs, drag !== null, 1000 / highestSampleRate);
	const windowStartMs = viewport.startMs;
	const windowEndMs = viewport.endMs;

	const durationSec = extent.endMs / 1000;

	const setViewportToFraction = useCallback(
		(fraction: number) => {
			const centerMs = fraction * minimapDurationMs;
			const span = viewport.endMs - viewport.startMs;

			viewport.setViewport({ startMs: centerMs - span / 2, endMs: centerMs + span / 2 });
		},
		[minimapDurationMs, viewport],
	);

	const viewStartFrac = minimapDurationMs > 0 ? Math.max(0, Math.min(1, windowStartMs / minimapDurationMs)) : 0;
	const viewEndFrac = minimapDurationMs > 0 ? Math.max(0, Math.min(1, windowEndMs / minimapDurationMs)) : 1;

	const minimapLayers = useMemo(
		() =>
			minimapLayersOf(
				renderableSources.map(({ source, audioData }) => ({
					source,
					audioData: placeAudioOnTimeline(audioData, source.timelineOffsetMs, minimapDurationMs),
				})),
			),
		[renderableSources, minimapDurationMs],
	);

	const playback = useTransportPlayback(durationSec);

	const transportControl = useMemo<TransportControl>(
		() => ({
			...playback,
			...readouts.control,
		}),
		[playback, readouts.control],
	);

	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(transportControl);
		}
	}, [onTransportControlChange, transportControl]);

	const trackCount = sources.length;
	const defaultRange = useMemo(() => defaultTrackRangeOf(trackCount), [trackCount]);
	const minSpan = Math.min(TRACK_MIN_SPAN, defaultRange.end);
	const [trackRange, setTrackRange] = useState<{ readonly count: number; readonly range: AxisRange }>({
		count: trackCount,
		range: defaultRange,
	});
	const yRange = trackRange.count === trackCount ? trackRange.range : defaultRange;
	const setYRange = useCallback((range: AxisRange) => setTrackRange({ count: trackCount, range }), [trackCount]);
	const visibleTracks = visibleTracksOf(yRange, trackCount);
	const trackHeight = trackHeightStyleOf(trackCount);

	const stripViewportRef = useRef<HTMLDivElement>(null);
	const wheelStateRef = useRef({ trackCount, defaultRange, minSpan, yRange });

	wheelStateRef.current = { trackCount, defaultRange, minSpan, yRange };

	useEffect(() => {
		const element = stripViewportRef.current;

		if (!element) return;

		const onWheel = (event: WheelEvent) => {
			const state = wheelStateRef.current;
			const rect = element.getBoundingClientRect();

			if (event.ctrlKey || event.metaKey || state.yRange.end - state.yRange.start >= 1 || rect.height <= 0) return;

			event.preventDefault();
			event.stopPropagation();
			setTrackRange((previous) => {
				const current = previous.count === state.trackCount ? previous.range : state.defaultRange;
				const delta = (event.deltaY / rect.height) * (current.end - current.start);

				return { count: state.trackCount, range: panAxisRange(current, delta, state.minSpan) };
			});
		};

		element.addEventListener("wheel", onWheel, { passive: false });

		return () => {
			element.removeEventListener("wheel", onWheel);
		};
	}, []);

	const replaceSource = useCallback(
		(next: Source) => onSourcesChange?.(sources.map((source) => (source.id === next.id ? next : source))),
		[onSourcesChange, sources],
	);

	return (
		<ViewProgressProvider>
			<div
				className="flex h-full min-h-0 w-full overflow-hidden bg-void"
				onDragOver={(event) => {
					if (event.dataTransfer.types.includes("Files")) event.preventDefault();
				}}
				onDrop={(event) => {
					if (event.dataTransfer.files.length === 0) return;

					event.preventDefault();

					const filePaths = droppedAudioFilePathsOf([...event.dataTransfer.files], (file) =>
						main.pathForFile(file),
					);

					if (filePaths.length > 0) onAddSourceFiles?.(filePaths);
				}}
			>
				<div
					className="min-h-0 min-w-0 flex-1 overflow-hidden"
					style={{
						display: "grid",
						gridTemplateColumns: "minmax(0, 1fr)",
						gridTemplateRows: "auto minmax(0, 1fr) auto",
					}}
				>
					<TimeRuler startMs={windowStartMs} endMs={windowEndMs} />

					<div className="relative flex min-h-0 flex-col bg-void">
						<CursorSurface
							surfaceRef={viewport.wheelHandlers.ref}
							startMs={windowStartMs}
							endMs={windowEndMs}
							cursorMs={viewSync.cursor}
							onCursorChange={viewSync.setCursor}
							className="relative min-h-0 flex-1 overflow-hidden bg-void"
						>
							<div ref={stripViewportRef} className="absolute inset-0 overflow-hidden">
								<div className="absolute inset-x-0 flex flex-col" style={trackStackStyleOf(yRange)}>
									{sources.map((source, index) => (
										<TimelineTrack
											key={source.id}
											source={source}
											audioData={sourceAudio.get(source.id)}
											status={sourceStatus?.get(source.id)}
											error={sourceErrors?.get(source.id)}
											height={trackHeight}
											offsetMs={
												drag?.id === source.id
													? Math.max(0, drag.offsetMs)
													: Math.max(0, source.timelineOffsetMs)
											}
											windowStartMs={windowStartMs}
											windowEndMs={windowEndMs}
											committedStartMs={viewport.committedStartMs}
											committedEndMs={viewport.committedEndMs}
											freezeCompute={
												drag !== null ||
												viewport.startMs !== viewport.committedStartMs ||
												viewport.endMs !== viewport.committedEndMs
											}
											extentEndMs={extent.endMs}
											frequencyScale={settings.frequencyScale}
											spectrogramSampling={settings.spectrogramSampling}
											spectrogramColormap={settings.spectrogramColormap}
											fftSize={settings.fftSize}
											hopOverlap={settings.hopOverlap}
											channelInput={channelInput}
											waveformOpacity={settings.waveformOpacity}
											spectrogramOpacity={settings.spectrogramOpacity}
											draggable={onSourceOffsetChange !== undefined}
											dragging={drag?.id === source.id}
											handleTop={trackHandleTopOf(yRange, index, trackCount)}
											onCursorMove={readouts.setCursorReadout}
											onDisplayedResultChange={readouts.onDisplayedResultChange}
											onDragMove={(offsetMs) => {
												setDrag({ id: source.id, offsetMs });
											}}
											onCommit={(offsetMs) => {
												setDrag(null);
												onSourceOffsetChange?.(source.id, offsetMs);
											}}
											onSourceChange={onSourcesChange ? replaceSource : undefined}
											onRetry={onRetrySource ? () => onRetrySource(source.id) : undefined}
											onRelink={onRelinkSource ? () => onRelinkSource(source.id) : undefined}
											onRemove={
												onSourcesChange
													? () => onSourcesChange(sources.filter((entry) => entry.id !== source.id))
													: undefined
											}
										/>
									))}
									<div className="relative z-[3] flex h-14 shrink-0 items-center justify-center border border-dashed border-chrome-border bg-void">
										<Button variant="primary" className="px-1 py-0.5" onClick={onAddSources}>
											<Icon icon="lucide:plus" width={16} height={16} aria-hidden="true" />
											Add Source
										</Button>
										<span className="ml-3 font-body text-sm text-chrome-text-dim">
											or drop audio files here
										</span>
									</div>
								</div>
							</div>
							{renderableSources.length > 0 && (
								<GridOverlay startMs={windowStartMs} endMs={windowEndMs} opacity={settings.gridOpacity} />
							)}
							<CursorLine fraction={timeToFraction(viewSync.cursor, windowStartMs, windowEndMs)} />
						</CursorSurface>
						<ViewProgressToast />
					</div>

					<MinimapDisplay
						layers={minimapLayers}
						viewStartFrac={viewStartFrac}
						viewEndFrac={viewEndFrac}
						channelInput={channelInput}
						onScrubToFraction={setViewportToFraction}
					/>
				</div>
				{trackCount === 0 ? (
					<div className="w-2 shrink-0" />
				) : (
					<div className="flex shrink-0 flex-col">
						<div className="h-8" />
						<ScrollTrack
							axis="y"
							className="min-h-0 flex-1"
							range={yRange}
							minSpan={minSpan}
							onRangeChange={setYRange}
							label="Track range"
							valueText={`tracks ${visibleTracks.first} to ${visibleTracks.last} of ${trackCount}`}
							edgeLabels={["Upper track range", "Lower track range"]}
							edgeValueTexts={[`track ${visibleTracks.first}`, `track ${visibleTracks.last}`]}
						/>
						<div className="h-8" />
					</div>
				)}
			</div>
		</ViewProgressProvider>
	);
}
