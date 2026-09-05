import { Icon } from "@iconify/react";
import { useCallback, useRef } from "react";
import { IconButton } from "../components/IconButton";
import type { ReactNode } from "react";

export interface TransportCursorReadout {
	readonly time: string;
	readonly freq?: string;
	readonly amp: string;
}

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
	readonly onVolumeChange: (volume: number) => void;
	/**
	 * The active view's display-control cluster, rendered into the transport's
	 * left region. Built by the comparison host (`TransportViewControls`) so the
	 * transport stays layout-only — it owns no view-control state. Absent for
	 * views with no display controls (Correlation), collapsing the left region.
	 */
	readonly viewControls?: ReactNode;
}

function formatTimecode(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return "00:00.000";

	const totalMs = Math.floor(sec * 1000);
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const mins = Math.floor(totalSec / 60);
	const secs = totalSec % 60;

	return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

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
			<span className={`flex items-center justify-center ${active && !disabled ? "bg-primary" : ""}`}>
				<Icon icon={icon} width={large ? 24 : 17} height={large ? 24 : 17} />
			</span>
		</button>
	);
}

interface PointReadout {
	readonly time: string;
	readonly amp: string;
	readonly freq?: string;
}

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
	const rowLabelClass = "font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim";
	const valueClass = `font-technical text-[length:var(--text-sm)] tabular-nums text-right ${
		disabled ? "text-chrome-text-dim" : "text-chrome-text"
	}`;

	return (
		<div
			className="hidden shrink-0 items-baseline gap-x-3 gap-y-1 leading-none min-[1400px]:grid"
			style={{ gridTemplateColumns: "auto repeat(3, minmax(0, 1fr))" }}
		>
			<span />
			<span className={headClass}>Cursor</span>
			<span className={headClass}>In</span>
			<span className={headClass}>Out</span>

			<span className={rowLabelClass}>Time</span>
			<span className={valueClass}>{cursor.time}</span>
			<span className={valueClass}>{selectionIn.time}</span>
			<span className={valueClass}>{selectionOut.time}</span>

			<span className={rowLabelClass}>Freq</span>
			<span className={valueClass}>{cursor.freq ?? "— Hz"}</span>
			<span />
			<span />

			<span className={rowLabelClass}>Amp</span>
			<span className={valueClass}>{cursor.amp}</span>
			<span className={valueClass}>{selectionIn.amp}</span>
			<span className={valueClass}>{selectionOut.amp}</span>
		</div>
	);
}

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
	const glyph = volume === 0 ? "lucide:volume-x" : volume < 0.5 ? "lucide:volume-1" : "lucide:volume-2";

	return (
		<div className="flex items-center gap-2">
			<Icon icon={glyph} width={16} height={16} className="shrink-0 text-chrome-text-secondary" aria-hidden="true" />
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
				<div
					className="pointer-events-none absolute inset-y-0 left-0 bg-chrome-text"
					style={{ width: `${pct}%` }}
				/>
				<div
					className="pointer-events-none absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 bg-chrome-text"
					style={{ left: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

export function Transport({ control, volume, onVolumeChange, viewControls }: TransportProps) {
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
	const timecodeSecondaryClass = disabled ? "text-chrome-text-dim" : "text-chrome-text-secondary";

	const selectionInLabel = selectionInSec !== undefined ? formatTimecode(selectionInSec) : "—";
	const selectionOutLabel = selectionOutSec !== undefined ? formatTimecode(selectionOutSec) : "—";

	return (
		<div className="flex h-full items-center bg-void px-4">
			<div className="flex min-w-0 flex-1 items-center">{viewControls}</div>

			<div className="flex shrink-0 flex-col items-center justify-center gap-1.5">
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
					<IconButton icon="lucide:repeat" label="Loop" size={16} variant="ghost" dim disabled={disabled} />
				</div>

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

			<div className="flex min-w-0 flex-1 items-center">
				<div className="min-w-4 flex-1" />
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
				<div className="min-w-4 flex-1" />
				<div className="flex shrink-0 items-center justify-end">
					<VolumeSlider volume={volume} onVolumeChange={onVolumeChange} />
				</div>
			</div>
		</div>
	);
}
