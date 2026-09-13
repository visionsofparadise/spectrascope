import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourceRender } from "../SourceRender";
import { TimeRuler } from "../spectral/Axes";
import { hexToRgb255 } from "../spectral/colorUtil";
import { GridOverlay } from "../spectral/GridOverlay";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { trackPointerDrag } from "../spectral/pointerDrag";
import { ScrollTrack } from "../spectral/ScrollTrack";
import { SelectionSurface } from "../spectral/SelectionSurface";
import { useWaveformReadouts } from "../spectral/useWaveformReadouts";
import { useTransportPlayback } from "../spectral/viewScaffold";
import { useTimeViewport } from "../useTimeViewport";
import { FULL_AXIS_RANGE } from "../utils/axisRange";
import { placeAudioOnTimeline } from "../utils/placeAudioOnTimeline";
import { clipWindowIntersection, computeTimelineExtent } from "./timelineExtent";
import { EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { SourceRenderCursorReadout } from "../SourceRender";
import type { TimelineDrag } from "./timelineExtent";
import type { AudioData } from "../spectral/types";
import type { DisplayedWaveform } from "../spectral/useWaveformReadouts";
import type { TransportControl } from "../Transport";
import type { AxisRange } from "../utils/axisRange";
import type { ViewControlSettings } from "../viewSettings";
import type { FrequencyScale } from "spectral-display";
import type { ChannelInput } from "spectral-display";

const TRACK_MIN_SPAN = 1 / 4;
const TRACK_EDGE_EPSILON = 1e-9;

export function trackStackStyleOf(range: AxisRange): { readonly height: string; readonly top: string } {
	const span = range.end - range.start;

	return { height: `${100 / span}%`, top: `${(-range.start / span) * 100}%` };
}

export function visibleTracksOf(range: AxisRange, count: number): { readonly first: number; readonly last: number } {
	const first = Math.min(count, Math.floor(range.start * count + TRACK_EDGE_EPSILON) + 1);
	const last = Math.max(first, Math.min(count, Math.ceil(range.end * count - TRACK_EDGE_EPSILON)));

	return { first, last };
}

export function trackHandleTopOf(range: AxisRange, index: number, count: number): string {
	const hiddenFraction = Math.max(0, range.start * count - index);

	return `clamp(0px, ${hiddenFraction * 100}%, calc(100% - 1rem))`;
}

function TimelineTrack({
	source,
	audioData,
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
}: {
	readonly source: Source;
	readonly audioData: AudioData;
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
}) {
	const trackRef = useRef<HTMLDivElement>(null);

	const durationMs = audioData.durationMs;

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

	return (
		<div ref={trackRef} className="relative min-h-0 flex-1 overflow-hidden">
			{liveWindow && (
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
					{draggable && (
						<button
							type="button"
							onPointerDown={handlePointerDown}
							onKeyDown={handleKeyDown}
							aria-label={`Timeline offset for ${source.name}`}
							role="slider"
							aria-valuemin={0}
							aria-valuemax={Math.round(extentEndMs)}
							aria-valuenow={Math.round(offsetMs)}
							aria-valuetext={`${(offsetMs / 1000).toFixed(2)} seconds`}
							style={{ top: handleTop }}
							className={`absolute left-0 right-0 flex h-4 cursor-ew-resize items-center gap-1 px-1.5 outline-none focus-visible:ring-1 focus-visible:ring-primary ${
								dragging ? "bg-primary/30" : "bg-chrome-raised/70 hover:bg-chrome-raised"
							}`}
						>
							<span aria-hidden className="flex items-center gap-0.5">
								<span className="block h-2 w-px bg-chrome-text/70" />
								<span className="block h-2 w-px bg-chrome-text/70" />
								<span className="block h-2 w-px bg-chrome-text/70" />
							</span>
							<span className="truncate font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
								{source.name}
							</span>
						</button>
					)}
				</div>
			)}
		</div>
	);
}

interface TimelineViewProps {
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
}: TimelineViewProps) {
	const readouts = useWaveformReadouts();
	const [drag, setDrag] = useState<TimelineDrag | null>(null);
	const [yRange, setYRange] = useState<AxisRange>(FULL_AXIS_RANGE);

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

	const firstAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;
	const firstOffsetMs = renderableSources[0]?.source.timelineOffsetMs ?? 0;
	const minimapAudio = useMemo(
		() => placeAudioOnTimeline(firstAudio, firstOffsetMs, minimapDurationMs),
		[firstAudio, firstOffsetMs, minimapDurationMs],
	);
	const minimapColor = renderableSources[0]?.source.layerColor ?? {
		primary: "#B8B8C0",
		secondary: "#44444C",
	};

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

	const trackCount = renderableSources.length;
	const visibleTracks = visibleTracksOf(yRange, trackCount);

	return (
		<div className="flex h-full min-h-0 w-full overflow-hidden bg-void">
			<div
				className="min-h-0 min-w-0 flex-1 overflow-hidden"
				style={{
					display: "grid",
					gridTemplateColumns: "minmax(0, 1fr)",
					gridTemplateRows: "auto minmax(0, 1fr) auto",
				}}
			>
				<TimeRuler startMs={windowStartMs} endMs={windowEndMs} />

				<SelectionSurface
					ref={viewport.wheelHandlers.ref}
					startMs={windowStartMs}
					endMs={windowEndMs}
					seekOnClick
					className="relative flex flex-col overflow-hidden bg-void"
				>
					{renderableSources.length === 0 ? (
						<div className="flex h-full items-center justify-center">
							<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
						</div>
					) : (
						<>
							<div className="absolute inset-x-0 flex flex-col" style={trackStackStyleOf(yRange)}>
								{renderableSources.map(({ source, audioData }, index) => (
									<TimelineTrack
										key={source.id}
										source={source}
										audioData={audioData}
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
									/>
								))}
							</div>
							<GridOverlay startMs={windowStartMs} endMs={windowEndMs} opacity={settings.gridOpacity} />
						</>
					)}
				</SelectionSurface>

				<MinimapDisplay
					audioData={minimapAudio}
					viewStartFrac={viewStartFrac}
					viewEndFrac={viewEndFrac}
					waveformColor={hexToRgb255(minimapColor.primary)}
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
						minSpan={TRACK_MIN_SPAN}
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
	);
}
