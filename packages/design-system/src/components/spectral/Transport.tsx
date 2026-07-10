import { useCallback, useRef } from "react";
import { Icon } from "@iconify/react";
import { IconButton } from "../IconButton";

/**
 * Cursor readout — the time / frequency / amplitude values a view publishes to
 * show what's under the playhead. Waveform views publish all three; chart
 * views without a frequency axis (e.g. Loudness) omit `freq`. The waveform
 * views track this via `SourceStripCursorReadout`; the Transport surfaces it
 * in its left region so the readout has a stable home outside the workspace.
 */
export interface TransportCursorReadout {
	readonly time: string;
	/** Optional — chart views with no frequency axis (e.g. Loudness) omit it. */
	readonly freq?: string;
	readonly amp: string;
}

/**
 * TransportControl — the contract the active view publishes up to the shell.
 * Views that don't have playback publish a control with `disabled: true`.
 * `cursorReadout` is optional — waveform-bearing views provide it, line-chart
 * views (Loudness, FrequencyDistribution) leave it undefined and the left
 * region collapses.
 *
 * `onSeek` is part of the contract (the time ruler drives seeking), but the
 * Transport itself renders no scrub control — the ruler at the top of each
 * view is the seek affordance.
 */
export interface TransportControl {
	readonly disabled?: boolean;
	readonly playing: boolean;
	readonly positionSec: number;
	readonly durationSec: number;
	readonly onPlayToggle: () => void;
	readonly onSeek: (sec: number) => void;
	readonly cursorReadout?: TransportCursorReadout;
	/**
	 * Selection range — the In / Out columns of the transport's readout panel.
	 * Times are in seconds (the transport formats them to a timecode);
	 * amplitudes are pre-formatted strings. Optional — unset fields render an
	 * em-dash. Views publish these from their (placeholder) selection range.
	 */
	readonly selectionInSec?: number;
	readonly selectionOutSec?: number;
	readonly selectionInAmp?: string;
	readonly selectionOutAmp?: string;
}

interface TransportProps {
	readonly control: TransportControl;
	/**
	 * Monitor volume — `0` silent, `1` unity. A *controlled* value: the
	 * Transport renders the `VolumeSlider` from this prop and emits changes via
	 * `onVolumeChange`; it owns no volume state.
	 *
	 * Volume is a separate `Transport`-level prop pair rather than a field on
	 * `TransportControl` because `TransportControl` is published per *view* and
	 * volume is a monitor-level, comparison-wide concern — not a view concern.
	 * This mirrors `Workspace`'s controlled `activeView` / `onActiveViewChange`.
	 */
	readonly volume: number;
	/** Emitted when the monitor volume changes (drag or keyboard). */
	readonly onVolumeChange: (volume: number) => void;
}

/** Fixed width of the left readout panel (and the matching right volume
 *  region). Equal widths keep the centered media cluster on the bar's true
 *  centerline without `absolute` positioning. */
const SIDE_REGION = "w-80";

function formatTimecode(sec: number): string {
	// MM:SS.mmm — match the pre-pivot Transport's three-decimal milliseconds
	// (font-technical tabular-nums keeps the column width stable as digits
	// change). Always two-digit minutes/seconds; three-digit milliseconds.
	if (!Number.isFinite(sec) || sec < 0) return "00:00.000";

	const totalMs = Math.floor(sec * 1000);
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const mins = Math.floor(totalSec / 60);
	const secs = totalSec % 60;

	return `${mins.toString().padStart(2, "0")}:${secs
		.toString()
		.padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/**
 * MediaButton — button grammar: the outer `<button>` is a padded, transparent
 * click target; an inner `<span>` carries the background "chip" and hugs the
 * glyph. The chip only appears when `active`. The play button passes `large`
 * (bigger glyph) and `active` while playing.
 */
function MediaButton({
	icon,
	label,
	large,
	active,
	disabled,
	onClick,
}: {
	readonly icon: string;
	readonly label: string;
	readonly large?: boolean;
	readonly active?: boolean;
	readonly disabled?: boolean;
	readonly onClick?: () => void;
}) {
	const interactive = !disabled && Boolean(onClick);

	return (
		<button
			type="button"
			disabled={disabled}
			onClick={() => {
				if (interactive) onClick?.();
			}}
			className={`flex items-center justify-center px-1.5 py-1.5 ${
				disabled
					? "cursor-not-allowed text-chrome-text-dim"
					: active
						? "text-void"
						: "text-chrome-text-secondary hover:text-chrome-text"
			}`}
			aria-label={label}
		>
			<span
				className={`flex items-center justify-center ${
					active && !disabled ? "bg-primary" : ""
				}`}
			>
				<Icon icon={icon} width={large ? 24 : 17} height={large ? 24 : 17} />
			</span>
		</button>
	);
}

/** One point's readout. `freq` is optional — the In / Out selection markers
 *  carry only a time and an amplitude. */
interface PointReadout {
	readonly time: string;
	readonly amp: string;
	readonly freq?: string;
}

/**
 * ReadoutPanel — the transport's left panel. The cursor readout (Time / Freq /
 * Amp, each a label + value) keeps its original form in the first columns; the
 * In and Out selection markers are appended as two more value columns, aligned
 * row-for-row. The markers carry no frequency, so their Freq cell is blank.
 * `leading-none` keeps the four rows inside the bar height.
 *
 *           Cursor      In         Out
 *    Time   00:00.000   00:07.6    00:13.7
 *    Freq   — Hz
 *    Amp    — dB        -19.7 dB   -24.3 dB
 */
function ReadoutPanel({
	cursor,
	selectionIn,
	selectionOut,
	disabled,
}: {
	readonly cursor: PointReadout;
	readonly selectionIn: PointReadout;
	readonly selectionOut: PointReadout;
	readonly disabled?: boolean;
}) {
	const headClass =
		"font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-right text-chrome-text-dim";
	const rowLabelClass =
		"font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim";
	const valueClass = `font-technical text-[length:var(--text-sm)] tabular-nums text-right ${
		disabled ? "text-chrome-text-dim" : "text-chrome-text"
	}`;

	return (
		<div
			className="grid items-baseline gap-x-3 gap-y-1 leading-none"
			style={{ gridTemplateColumns: "auto repeat(3, minmax(0, 1fr))" }}
		>
			{/* Header row — a column label over each readout column. */}
			<span />
			<span className={headClass}>Cursor</span>
			<span className={headClass}>In</span>
			<span className={headClass}>Out</span>

			{/* Time row */}
			<span className={rowLabelClass}>Time</span>
			<span className={valueClass}>{cursor.time}</span>
			<span className={valueClass}>{selectionIn.time}</span>
			<span className={valueClass}>{selectionOut.time}</span>

			{/* Freq row — cursor only; the In / Out markers carry no frequency. */}
			<span className={rowLabelClass}>Freq</span>
			<span className={valueClass}>{cursor.freq ?? "— Hz"}</span>
			<span />
			<span />

			{/* Amp row */}
			<span className={rowLabelClass}>Amp</span>
			<span className={valueClass}>{cursor.amp}</span>
			<span className={valueClass}>{selectionIn.amp}</span>
			<span className={valueClass}>{selectionOut.amp}</span>
		</div>
	);
}

/**
 * VolumeSlider — monitor-level control in the Transport's right region. A
 * horizontal track (chrome-raised groove, chrome-text fill + handle) dragged
 * via pointer capture, with a speaker glyph that reflects the level.
 *
 * This is a *monitoring* control — it sets how loud the audition plays, not a
 * per-source gain. Sources carry no gain rider (per the 2026-05-20 "drop gain
 * knob" decision); the audition level is a single playback-side control and
 * the Transport is its home.
 *
 * Purely visual / controlled — it owns no volume state. The current `volume`
 * is rendered from the prop and every change is emitted through
 * `onVolumeChange`; the consumer (the desktop app, or the demo) owns the
 * state. This keeps the design-system component a visual element only.
 */
function VolumeSlider({
	volume,
	onVolumeChange,
}: {
	readonly volume: number;
	readonly onVolumeChange: (volume: number) => void;
}) {
	const trackRef = useRef<HTMLDivElement>(null);

	const setFromClientX = useCallback(
		(clientX: number) => {
			const track = trackRef.current;

			if (!track) return;

			const rect = track.getBoundingClientRect();

			if (rect.width <= 0) return;

			const frac = (clientX - rect.left) / rect.width;

			onVolumeChange(Math.max(0, Math.min(1, frac)));
		},
		[onVolumeChange],
	);

	const handlePointerDown = useCallback(
		(ev: React.PointerEvent<HTMLDivElement>) => {
			ev.currentTarget.setPointerCapture(ev.pointerId);
			setFromClientX(ev.clientX);
		},
		[setFromClientX],
	);

	const handlePointerMove = useCallback(
		(ev: React.PointerEvent<HTMLDivElement>) => {
			// Only track while a button is held (pointer capture keeps events
			// flowing here even when the cursor leaves the track).
			if (ev.buttons === 0) return;

			setFromClientX(ev.clientX);
		},
		[setFromClientX],
	);

	const handleKeyDown = useCallback(
		(ev: React.KeyboardEvent<HTMLDivElement>) => {
			const STEP = 0.05;

			if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
				ev.preventDefault();
				onVolumeChange(Math.max(0, volume - STEP));
			} else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
				ev.preventDefault();
				onVolumeChange(Math.min(1, volume + STEP));
			} else if (ev.key === "Home") {
				ev.preventDefault();
				onVolumeChange(0);
			} else if (ev.key === "End") {
				ev.preventDefault();
				onVolumeChange(1);
			}
		},
		[volume, onVolumeChange],
	);

	const pct = volume * 100;
	const glyph =
		volume === 0
			? "lucide:volume-x"
			: volume < 0.5
				? "lucide:volume-1"
				: "lucide:volume-2";

	return (
		<div className="flex items-center gap-2">
			<Icon
				icon={glyph}
				width={16}
				height={16}
				className="shrink-0 text-chrome-text-secondary"
				aria-hidden="true"
			/>
			<div
				ref={trackRef}
				role="slider"
				tabIndex={0}
				aria-label="Monitor volume"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(pct)}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onKeyDown={handleKeyDown}
				className="relative h-1 w-24 shrink-0 cursor-pointer bg-chrome-raised outline-none focus-visible:ring-1 focus-visible:ring-primary"
			>
				{/* Filled portion — level measured from the left edge. */}
				<div
					className="pointer-events-none absolute inset-y-0 left-0 bg-chrome-text"
					style={{ width: `${pct}%` }}
				/>
				{/* Handle — a thin vertical bar at the level position. */}
				<div
					className="pointer-events-none absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 bg-chrome-text"
					style={{ left: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

/**
 * Transport — the bottom strip of the center workspace column. Media-only:
 * the readout panel on the left (the cursor's Time / Freq / Amp plus the
 * In / Out selection markers), the media-control cluster centered with speed
 * and timecode beneath it, and the monitor volume on the right. There is no
 * scrub control — seeking is done on the time ruler at the top of each view.
 *
 *   ┌──────────────────────────┬───────────────────────┬────────────┐
 *   │          Cursor  In  Out │  media buttons + loop  │            │
 *   │   Time   ··      ··  ··  │  speed · timecode      │            │
 *   │   Freq   ··              │                        │   volume   │
 *   │   Amp    ··      ··  ··  │                        │            │
 *   └──────────────────────────┴───────────────────────┴────────────┘
 *
 * The left readout panel and the right volume region are equal fixed widths,
 * so the media cluster centers on the bar's true centerline without any
 * `absolute` positioning. Skip-back / chevrons / loop are visual stubs —
 * there's no view-side skip/loop API yet. Play/pause is wired; the In / Out
 * columns reflect `control.selectionIn*` / `selectionOut*`.
 *
 * The monitor `VolumeSlider` is controlled — `volume` / `onVolumeChange` are
 * `Transport`-level props the consumer owns.
 */
export function Transport({ control, volume, onVolumeChange }: TransportProps) {
	const {
		disabled,
		playing,
		positionSec,
		durationSec,
		onPlayToggle,
		cursorReadout,
		selectionInSec,
		selectionOutSec,
		selectionInAmp,
		selectionOutAmp,
	} = control;

	const timecodeMainClass = disabled ? "text-chrome-text-dim" : "text-chrome-text";
	const timecodeSecondaryClass = disabled
		? "text-chrome-text-dim"
		: "text-chrome-text-secondary";

	// Selection In/Out — em-dash when the active view publishes no selection.
	const selectionInLabel =
		selectionInSec !== undefined ? formatTimecode(selectionInSec) : "—";
	const selectionOutLabel =
		selectionOutSec !== undefined ? formatTimecode(selectionOutSec) : "—";

	return (
		<div className="flex h-full items-center gap-4 bg-void px-4">
			{/* Left — the readout panel: the cursor readout plus the In / Out
			    selection markers, side by side. */}
			<div className={`${SIDE_REGION} shrink-0`}>
				<ReadoutPanel
					cursor={{
						time: cursorReadout?.time ?? "—",
						freq: cursorReadout?.freq ?? "— Hz",
						amp: cursorReadout?.amp ?? "— dB",
					}}
					selectionIn={{
						time: selectionInLabel,
						amp: selectionInAmp ?? "— dB",
					}}
					selectionOut={{
						time: selectionOutLabel,
						amp: selectionOutAmp ?? "— dB",
					}}
					disabled={disabled}
				/>
			</div>

			{/* Center — media controls + speed/timecode. */}
			<div className="flex flex-1 flex-col items-center justify-center gap-1.5">
				<div className="flex items-center gap-2">
					<div className="flex items-center">
						<MediaButton icon="lucide:skip-back" label="Skip to start" disabled={disabled} />
						<MediaButton icon="lucide:chevrons-left" label="Jump back" disabled={disabled} />
						<MediaButton icon="lucide:chevron-left" label="Frame back" disabled={disabled} />
						<MediaButton
							icon={playing ? "lucide:pause" : "lucide:play"}
							label={playing ? "Pause" : "Play"}
							large
							active={playing}
							disabled={disabled}
							onClick={onPlayToggle}
						/>
						<MediaButton icon="lucide:chevron-right" label="Frame forward" disabled={disabled} />
						<MediaButton icon="lucide:chevrons-right" label="Jump forward" disabled={disabled} />
						<MediaButton icon="lucide:skip-forward" label="Skip to end" disabled={disabled} />
					</div>
					<IconButton
						icon="lucide:repeat"
						label="Loop"
						size={16}
						variant="ghost"
						dim
						disabled={disabled}
					/>
				</div>

				{/* Speed + timecode. The speed control is a visual stub (no
				    playback-rate plumbing yet) — outer button owns the padding,
				    inner span owns the chip and hugs its content. */}
				<div className="flex items-center gap-3">
					<button
						type="button"
						disabled={disabled}
						className={`flex shrink-0 items-center px-1 py-0.5 font-technical text-[length:var(--text-sm)] italic ${
							disabled ? "cursor-not-allowed text-chrome-text-dim" : "text-chrome-text"
						}`}
					>
						<span className="flex items-center gap-0.5 bg-chrome-raised">
							<span>1x</span>
							<Icon icon="lucide:chevron-down" width={12} height={12} />
						</span>
					</button>
					<span
						className={`shrink-0 font-technical text-[length:var(--text-sm)] tabular-nums ${timecodeMainClass}`}
					>
						{formatTimecode(positionSec)}
						<span className={timecodeSecondaryClass}> / </span>
						<span className={timecodeSecondaryClass}>{formatTimecode(durationSec)}</span>
					</span>
				</div>
			</div>

			{/* Right — monitor volume. Equal width to the left readout column
			    so the media cluster stays centered on the bar. */}
			<div className={`${SIDE_REGION} flex shrink-0 items-center justify-end`}>
				<VolumeSlider volume={volume} onVolumeChange={onVolumeChange} />
			</div>
		</div>
	);
}
