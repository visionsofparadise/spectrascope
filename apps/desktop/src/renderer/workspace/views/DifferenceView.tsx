
import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "../../components/Select";
import { SourceRender } from "../SourceRender";
import { FrequencyAxis, DbAxis, TimeRuler } from "../spectral/Axes";
import { FrequencyMinimap } from "../spectral/FrequencyMinimap";
import { MinimapDisplay } from "../spectral/MinimapDisplay";
import { Selection } from "../spectral/Selection";
import { useViewSync } from "../sync";
import { useTimeViewport } from "../useTimeViewport";
import { eventToTime, timeToFraction } from "./viewCursor";
import type { LayerColor } from "../layers";
import type { Source } from "../source";
import type { SourceRenderCursorReadout } from "../SourceRender";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { GridMode, ViewControlSettings } from "../viewSettings";
import type { ChannelInput } from "spectral-display";

function hexToRgb255(hex: string): [number, number, number] {
	const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
	const expanded =
		cleaned.length === 3
			? cleaned
					.split("")
					.map((char) => `${char}${char}`)
					.join("")
			: cleaned;
	const value = Number.parseInt(expanded, 16);

	if (Number.isNaN(value) || expanded.length !== 6) {
		return [184, 184, 192];
	}

	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

interface DifferenceViewProps {
	readonly sources: ReadonlyArray<Source>;
	/**
	 * The A−B difference signal as a single PCM reader, backed by the registered
	 * diff stream (`EMPTY_DERIVED_AUDIO` until A and B both resolve).
	 */
	readonly derivedAudio: AudioData;
	readonly channelInput: ChannelInput;
	readonly settings: ViewControlSettings;
	/**
	 * The A/B source selection (source ids), or `null` until the sticky default
	 * is written. `A − B`: A is the reference, B is polarity-inverted. A `null`
	 * or dangling (removed-source) field falls back to the default first-two in
	 * the selector display.
	 */
	readonly differenceA: string | null;
	readonly differenceB: string | null;
	readonly onDifferenceChange: (differenceA: string, differenceB: string) => void;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const EMPTY_VIEW_SYNC = {
	cursor: null,
	selection: null,
} as const;

const DEFAULT_CURSOR: SourceRenderCursorReadout = {
	time: "00:00.000",
	freq: "— Hz",
	amp: "— dB",
};

function GridOverlay({
	startMs,
	endMs,
	mode,
	opacity,
}: {
	readonly startMs: number;
	readonly endMs: number;
	readonly mode: GridMode;
	readonly opacity: number;
}) {
	const spanMs = endMs - startMs;

	let majorMs = 5000;

	if (spanMs < 2000) majorMs = 200;
	else if (spanMs < 5000) majorMs = 500;
	else if (spanMs < 10000) majorMs = 1000;
	else if (spanMs < 30000) majorMs = 2000;
	else if (spanMs < 60000) majorMs = 5000;
	else majorMs = 10000;

	const timeTicks: Array<number> = [];
	const first = Math.ceil(startMs / majorMs) * majorMs;

	for (let tick = first; tick <= endMs; tick += majorMs) {
		timeTicks.push((tick - startMs) / spanMs);
	}

	const hLines: Array<number> = [];

	if (mode === "freq") {
		const FREQ_MIN = 20;
		const FREQ_MAX = 22050;
		const melMin = 2595 * Math.log10(1 + FREQ_MIN / 700);
		const melMax = 2595 * Math.log10(1 + FREQ_MAX / 700);

		for (const hz of [100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
			const mel = 2595 * Math.log10(1 + hz / 700);

			hLines.push(1 - (mel - melMin) / (melMax - melMin));
		}
	} else {
		const dbToLinear = (db: number) => Math.pow(10, db / 20);

		for (const db of [-3, -6, -12, -24]) {
			const amp = dbToLinear(db);

			hLines.push((1 - amp) * 0.5);
			hLines.push(0.5 + amp * 0.5);
		}

		hLines.push(0.5);
	}

	return (
		<div className="pointer-events-none absolute inset-0" style={{ opacity }}>
			{timeTicks.map((frac) => (
				<div
					key={`t${frac}`}
					className="absolute top-0 bottom-0 w-px bg-chrome-text"
					style={{ left: `${frac * 100}%` }}
				/>
			))}
			{hLines.map((frac, index) => (
				<div
					key={`h${index}`}
					className="absolute left-0 right-0 h-px bg-chrome-text"
					style={{ top: `${frac * 100}%` }}
				/>
			))}
		</div>
	);
}

const DIFFERENCE_NEUTRAL_COLOR: LayerColor = {
	primary: "#B8B8C0",
	secondary: "#44444C",
};

export function DifferenceView({
	sources,
	derivedAudio,
	channelInput,
	settings,
	differenceA,
	differenceB,
	onDifferenceChange,
	onTransportControlChange,
}: DifferenceViewProps) {
	const [cursorReadout, setCursorReadout] = useState<SourceRenderCursorReadout>(DEFAULT_CURSOR);

	const viewSync = useViewSync("difference", EMPTY_VIEW_SYNC);

	const viewport = useTimeViewport(0, derivedAudio.durationMs);
	const startMs = viewport.committedStartMs;
	const endMs = viewport.committedEndMs;

	const setViewportToFraction = useCallback(
		(fraction: number) => {
			const centerMs = fraction * derivedAudio.durationMs;
			const span = viewport.endMs - viewport.startMs;

			viewport.setViewport({ startMs: centerMs - span / 2, endMs: centerMs + span / 2 });
		},
		[derivedAudio.durationMs, viewport],
	);

	const viewStartFrac = derivedAudio.durationMs > 0 ? viewport.startMs / derivedAudio.durationMs : 0;
	const viewEndFrac = derivedAudio.durationMs > 0 ? viewport.endMs / derivedAudio.durationMs : 1;

	const [playing, setPlaying] = useState(false);
	const [positionSec, setPositionSec] = useState(0);
	const durationSec = derivedAudio.durationMs / 1000;

	const visibleSources = useMemo(() => sources.filter((source) => source.visible), [sources]);

	const anySoloed = sources.some((source) => source.soloed);
	const audibleSources = anySoloed
		? sources.filter((source) => source.soloed)
		: sources.filter((source) => !source.muted && source.visible);

	void audibleSources;

	const differenceSource = useMemo<Source>(() => {
		const anchorColor = visibleSources[0]?.layerColor ?? DIFFERENCE_NEUTRAL_COLOR;

		return {
			id: "difference",
			name: "Difference",
			audioFilePath: "derived",
			timelineOffsetMs: 0,
			layerColor: anchorColor,
			visible: true,
			muted: false,
			soloed: false,
		};
	}, [visibleSources]);

	const onPlayToggle = useCallback(() => {
		setPlaying((prev) => !prev);
	}, []);

	const onSeek = useCallback(
		(sec: number) => {
			setPositionSec(Math.max(0, Math.min(durationSec, sec)));
		},
		[durationSec],
	);

	const handleCursorClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const time = eventToTime(event, startMs, endMs);

			if (time !== null) viewSync.setCursor(time);
		},
		[viewSync, startMs, endMs],
	);

	const transportControl = useMemo<TransportControl>(
		() => ({
			playing,
			positionSec,
			durationSec,
			onPlayToggle,
			onSeek,
			cursorReadout,
			selectionInSec: viewSync.selection !== null ? viewSync.selection.start / 1000 : undefined,
			selectionOutSec: viewSync.selection !== null ? viewSync.selection.end / 1000 : undefined,
		}),
		[playing, positionSec, durationSec, onPlayToggle, onSeek, cursorReadout, viewSync.selection],
	);

	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(transportControl);
		}
	}, [onTransportControlChange, transportControl]);

	const cursorFrac = timeToFraction(viewSync.cursor, startMs, endMs);
	const selectionStartFrac = timeToFraction(viewSync.selection?.start ?? null, startMs, endMs);
	const selectionEndFrac = timeToFraction(viewSync.selection?.end ?? null, startMs, endMs);

	const minimapLayerColor = differenceSource.layerColor;


	const sourceOptions = useMemo(() => sources.map((source) => ({ value: source.id, label: source.name })), [sources]);

	const sourceIds = useMemo(() => new Set(sources.map((source) => source.id)), [sources]);
	const selectedA = differenceA !== null && sourceIds.has(differenceA) ? differenceA : (sources[0]?.id ?? "");
	const selectedB = differenceB !== null && sourceIds.has(differenceB) ? differenceB : (sources[1]?.id ?? "");

	const handleSelectA = useCallback(
		(next: string) => {
			onDifferenceChange(next, selectedB);
		},
		[onDifferenceChange, selectedB],
	);

	const handleSelectB = useCallback(
		(next: string) => {
			onDifferenceChange(selectedA, next);
		},
		[onDifferenceChange, selectedA],
	);

	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-void">
			<div className="flex shrink-0 items-center gap-4 border-b border-chrome-border-subtle bg-void px-3 py-1.5">
				<div className="flex items-center gap-1.5">
					<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-secondary">
						A
					</span>
					<Select variant="chip" value={selectedA} options={sourceOptions} onChange={handleSelectA} />
				</div>
				<span aria-hidden className="font-technical text-[length:var(--text-sm)] text-chrome-text-dim">
					−
				</span>
				<div className="flex items-center gap-1.5">
					<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-secondary">
						B − inverted
					</span>
					<Select variant="chip" value={selectedB} options={sourceOptions} onChange={handleSelectB} />
				</div>
			</div>
			<div
				className="min-h-0 min-w-0 flex-1 overflow-hidden"
				style={{
					display: "grid",
					gridTemplateColumns: "2.5rem minmax(0, 1fr) auto auto",
					gridTemplateRows: "2rem minmax(0, 1fr) 2rem",
				}}
			>
				<div className="bg-void" />
				<TimeRuler startMs={startMs} endMs={endMs} />
				<div className="bg-void" />
				<div className="bg-void" />

				<FrequencyAxis />

				<div
					ref={viewport.wheelHandlers.ref}
					className="relative cursor-crosshair overflow-hidden bg-void"
					onClick={handleCursorClick}
				>
					<div className="absolute inset-0">
						<SourceRender
							source={differenceSource}
							audioData={derivedAudio}
							startMs={startMs}
							endMs={endMs}
							liveStartMs={viewport.startMs}
							liveEndMs={viewport.endMs}
							fftSize={settings.fftSize}
							hopOverlap={settings.hopOverlap}
							channelInput={channelInput}
							waveformOpacity={settings.waveformOpacity}
							spectrogramOpacity={settings.spectrogramOpacity}
							onCursorMove={setCursorReadout}
						/>
					</div>
					<GridOverlay startMs={startMs} endMs={endMs} mode={settings.gridMode} opacity={settings.gridOpacity} />
					{selectionStartFrac !== null && selectionEndFrac !== null && (
						<Selection startFraction={selectionStartFrac} endFraction={selectionEndFrac} />
					)}
					{cursorFrac !== null && cursorFrac >= 0 && cursorFrac <= 1 && (
						<div
							className="pointer-events-none absolute top-0 bottom-0 w-px bg-data-cursor"
							style={{ left: `${cursorFrac * 100}%` }}
						/>
					)}
				</div>

				<FrequencyMinimap audioData={derivedAudio} startMs={startMs} endMs={endMs} layerColor={minimapLayerColor} />
				<DbAxis />

				<div className="bg-void" />
				<MinimapDisplay
					audioData={derivedAudio}
					viewStartFrac={viewStartFrac}
					viewEndFrac={viewEndFrac}
					waveformColor={hexToRgb255(minimapLayerColor.primary)}
					onScrubToFraction={setViewportToFraction}
				/>
				<div className="bg-void" />
				<div className="bg-void" />
			</div>
		</div>
	);
}
