
import { useCallback, useEffect, useMemo, useState } from "react";
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

interface SumViewProps {
	readonly sources: ReadonlyArray<Source>;
	/**
	 * The derived (summed) signal as a single PCM reader, backed by the
	 * registered sum `media://` stream (`EMPTY_DERIVED_AUDIO` until audible).
	 */
	readonly derivedAudio: AudioData;
	readonly channelInput: ChannelInput;
	readonly settings: ViewControlSettings;
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

const SUM_LAYER_COLOR: LayerColor = {
	primary: "#A3E635",
	secondary: "#440154",
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

export function SumView({ sources, derivedAudio, channelInput, settings, onTransportControlChange }: SumViewProps) {
	const [cursorReadout, setCursorReadout] = useState<SourceRenderCursorReadout>(DEFAULT_CURSOR);

	const viewSync = useViewSync("sum", EMPTY_VIEW_SYNC);

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

	const sumSource = useMemo<Source>(
		() => ({
			id: "sum",
			name: "Σ all sources",
			audioFilePath: "derived",
			timelineOffsetMs: 0,
			layerColor: SUM_LAYER_COLOR,
			visible: true,
			muted: false,
			soloed: false,
		}),
		[],
	);

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

	const minimapLayerColor = SUM_LAYER_COLOR;

	return (
		<div className="flex h-full min-h-0 w-full overflow-hidden bg-void">
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
					{visibleSources.length === 0 ? (
						<div className="flex h-full items-center justify-center">
							<p className="font-technical text-sm text-chrome-text-dim">No visible sources</p>
						</div>
					) : (
						<>
							<div className="absolute inset-0">
								<SourceRender
									source={sumSource}
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
							<GridOverlay
								startMs={startMs}
								endMs={endMs}
								mode={settings.gridMode}
								opacity={settings.gridOpacity}
							/>
							{selectionStartFrac !== null && selectionEndFrac !== null && (
								<Selection startFraction={selectionStartFrac} endFraction={selectionEndFrac} />
							)}
							{cursorFrac !== null && cursorFrac >= 0 && cursorFrac <= 1 && (
								<div
									className="pointer-events-none absolute top-0 bottom-0 w-px bg-data-cursor"
									style={{ left: `${cursorFrac * 100}%` }}
								/>
							)}
						</>
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
