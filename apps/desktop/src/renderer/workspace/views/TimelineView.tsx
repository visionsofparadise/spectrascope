import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourceRender } from "../SourceRender";
import { TimeRuler } from "../spectral/Axes";
import { hexToRgb255 } from "../spectral/colorUtil";
import { GridOverlay } from "../spectral/GridOverlay";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { trackPointerDrag } from "../spectral/pointerDrag";
import { useTimeViewport } from "../useTimeViewport";
import { computeTimelineExtent } from "./timelineExtent";
import { EMPTY_AUDIO_DATA, resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { SourceRenderCursorReadout } from "../SourceRender";
import type { TimelineDrag } from "./timelineExtent";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { ViewControlSettings } from "../viewSettings";
import type { ChannelInput } from "spectral-display";

const DEFAULT_CURSOR: SourceRenderCursorReadout = {
	time: "00:00.000",
	freq: "— Hz",
	amp: "— dB",
};

function TimelineTrack({
	source,
	audioData,
	offsetMs,
	windowStartMs,
	windowEndMs,
	extentEndMs,
	fftSize,
	hopOverlap,
	channelInput,
	gridOpacity,
	waveformOpacity,
	spectrogramOpacity,
	draggable,
	dragging,
	onCursorMove,
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
	readonly extentEndMs: number;
	readonly fftSize: number;
	readonly hopOverlap: number;
	readonly channelInput: ChannelInput;
	readonly gridOpacity: number;
	readonly waveformOpacity: number;
	readonly spectrogramOpacity: number;
	readonly draggable: boolean;
	readonly dragging: boolean;
	readonly onCursorMove: (readout: SourceRenderCursorReadout) => void;
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
	const leftPct = ((offsetMs - windowStartMs) / span) * 100;
	const widthPct = (durationMs / span) * 100;

	return (
		<div ref={trackRef} className="relative min-h-0 flex-1 overflow-hidden">
			<div className="absolute inset-y-0" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
				<SourceRender
					source={source}
					audioData={audioData}
					startMs={0}
					endMs={durationMs}
					fftSize={fftSize}
					hopOverlap={hopOverlap}
					channelInput={channelInput}
					waveformOpacity={waveformOpacity}
					spectrogramOpacity={spectrogramOpacity}
					onCursorMove={onCursorMove}
				/>
				<GridOverlay startMs={0} endMs={durationMs} opacity={gridOpacity} />
				<div
					aria-hidden
					className={`pointer-events-none absolute inset-y-0 left-0 w-0.5 ${
						dragging ? "bg-primary" : "bg-chrome-text/60"
					}`}
				/>
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
						className={`absolute top-0 left-0 right-0 flex h-4 cursor-ew-resize items-center gap-1 px-1.5 outline-none focus-visible:ring-1 focus-visible:ring-primary ${
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
	const [playing, setPlaying] = useState(false);
	const [positionSec, setPositionSec] = useState(0);
	const [cursorReadout, setCursorReadout] = useState<SourceRenderCursorReadout>(DEFAULT_CURSOR);
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

	const viewport = useTimeViewport(extent.startMs, extent.endMs);
	const windowStartMs = viewport.committedStartMs;
	const windowEndMs = viewport.committedEndMs;

	const extentSpanMs = extent.endMs - extent.startMs;
	const durationSec = extent.endMs / 1000;

	const setViewportToFraction = useCallback(
		(fraction: number) => {
			const centerMs = extent.startMs + fraction * extentSpanMs;
			const span = viewport.endMs - viewport.startMs;

			viewport.setViewport({ startMs: centerMs - span / 2, endMs: centerMs + span / 2 });
		},
		[extent.startMs, extentSpanMs, viewport],
	);

	const viewStartFrac = extentSpanMs > 0 ? (windowStartMs - extent.startMs) / extentSpanMs : 0;
	const viewEndFrac = extentSpanMs > 0 ? (windowEndMs - extent.startMs) / extentSpanMs : 1;

	const minimapAudio = renderableSources[0]?.audioData ?? EMPTY_AUDIO_DATA;
	const minimapColor = renderableSources[0]?.source.layerColor ?? {
		primary: "#B8B8C0",
		secondary: "#44444C",
	};

	const anySoloed = sources.some((source) => source.soloed);
	const audibleSources = anySoloed
		? sources.filter((source) => source.soloed)
		: sources.filter((source) => !source.muted && source.visible);

	// eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator
	void audibleSources;

	const onPlayToggle = useCallback(() => {
		setPlaying((previous) => !previous);
	}, []);

	const onSeek = useCallback(
		(sec: number) => {
			setPositionSec(Math.max(0, Math.min(durationSec, sec)));
		},
		[durationSec],
	);

	const transportControl = useMemo<TransportControl>(
		() => ({
			playing,
			positionSec,
			durationSec,
			onPlayToggle,
			onSeek,
			cursorReadout,
			selectionInSec: durationSec * 0.25,
			selectionOutSec: durationSec * 0.45,
			selectionInAmp: "-19.7 dB",
			selectionOutAmp: "-24.3 dB",
		}),
		[playing, positionSec, durationSec, onPlayToggle, onSeek, cursorReadout],
	);

	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(transportControl);
		}
	}, [onTransportControlChange, transportControl]);

	const windowSpanMs = windowEndMs - windowStartMs;
	const playheadFrac = windowSpanMs > 0 ? (positionSec * 1000 - windowStartMs) / windowSpanMs : 0;
	const playheadVisible = playheadFrac >= 0 && playheadFrac <= 1;

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

				<div ref={viewport.wheelHandlers.ref} className="relative flex flex-col overflow-hidden bg-void">
					{renderableSources.length === 0 ? (
						<div className="flex h-full items-center justify-center">
							<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
						</div>
					) : (
						<>
							<div
								className="absolute inset-0 flex flex-col"
								style={{
									transform: viewport.transform,
									transformOrigin: "left",
								}}
							>
								{renderableSources.map(({ source, audioData }) => (
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
										extentEndMs={extent.endMs}
										fftSize={settings.fftSize}
										hopOverlap={settings.hopOverlap}
										channelInput={channelInput}
										gridOpacity={settings.gridOpacity}
										waveformOpacity={settings.waveformOpacity}
										spectrogramOpacity={settings.spectrogramOpacity}
										draggable={onSourceOffsetChange !== undefined}
										dragging={drag?.id === source.id}
										onCursorMove={setCursorReadout}
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
							{playheadVisible && (
								<div
									aria-hidden
									className="pointer-events-none absolute top-0 bottom-0 w-px bg-data-cursor"
									style={{ left: `${playheadFrac * 100}%` }}
								/>
							)}
						</>
					)}
				</div>

				<MinimapDisplay
					audioData={minimapAudio}
					viewStartFrac={viewStartFrac}
					viewEndFrac={viewEndFrac}
					waveformColor={hexToRgb255(minimapColor.primary)}
					onScrubToFraction={setViewportToFraction}
				/>
			</div>
		</div>
	);
}
