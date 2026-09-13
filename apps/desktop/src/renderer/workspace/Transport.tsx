import { Icon } from "@iconify/react";
import { useCallback, useId, useRef } from "react";
import { IconButton } from "../components/IconButton";
import { Select } from "../components/Select";
import { formatInspectionTime } from "./utils/formatInspectionTime";
import type { ReactNode } from "react";

interface TransportCursorReadout {
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
	readonly readoutSourceName?: string;
	readonly amplitudeLabel?: string;
	/**
	 * Selection range — the In / Out columns of the transport's readout panel.
	 * Times are in seconds (the transport formats them to a timecode);
	 * amplitudes are pre-formatted strings. Optional — unset fields render an
	 * em-dash. Views publish measurements for the shared selection range.
	 */
	readonly selectionInSec?: number;
	readonly selectionOutSec?: number;
	readonly selectionInAmp?: string;
	readonly selectionOutAmp?: string;
}

interface TransportProps {
	readonly control: TransportControl;
	readonly playbackRate: number;
	readonly onPlaybackRateChange: (rate: number) => void;
	readonly looping: boolean;
	readonly onLoopingChange: (looping: boolean) => void;
	readonly sampleRate: number;
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

const PLAYBACK_RATE_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => ({
	value: String(rate),
	label: `${rate}x`,
}));

function formatTimecode(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return "00:00.000";

	const totalMs = Math.floor(sec * 1000);
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const mins = Math.floor(totalSec / 60);
	const secs = totalSec % 60;

	return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

function PlaybackGlyph({ playing }: { readonly playing: boolean }) {
	return (
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{playing ? (
				<>
					<rect x="14" y="3" width="5" height="18" rx="1" />
					<rect x="5" y="3" width="5" height="18" rx="1" />
				</>
			) : (
				<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
			)}
		</svg>
	);
}

function MediaButton({
	icon,
	label,
	large,
	active,
	disabled,
	onClick,
}: {
	readonly icon: ReactNode;
	readonly label: string;
	readonly large?: boolean;
	readonly active?: boolean;
	readonly disabled?: boolean;
	readonly onClick?: () => void;
}) {
	const interactive = !disabled && Boolean(onClick);
	const iconSize = large ? 24 : 17;

	return (
		<button
			type="button"
			disabled={disabled}
			onClick={() => {
				if (interactive) onClick?.();
			}}
			className={`flex shrink-0 items-center justify-center p-1.5 ${
				disabled
					? "cursor-not-allowed text-chrome-text-dim"
					: active
						? "text-void"
						: "text-chrome-text-secondary hover:text-chrome-text"
			}`}
			aria-label={label}
		>
			<span
				className={`flex items-center justify-center ${large ? "size-6" : "size-[17px]"} ${
					active && !disabled ? "bg-primary" : ""
				}`}
			>
				{typeof icon === "string" ? <Icon icon={icon} width={iconSize} height={iconSize} /> : icon}
			</span>
		</button>
	);
}

function TransportCluster({
	label,
	icon,
	inlineClassName,
	compactClassName,
	children,
}: {
	readonly label: string;
	readonly icon: string;
	readonly inlineClassName: string;
	readonly compactClassName: string;
	readonly children: ReactNode;
}) {
	const id = useId();

	return (
		<>
			<div className={inlineClassName}>{children}</div>
			<div className={compactClassName}>
				<button
					type="button"
					aria-label={label === "View" ? "View controls" : label}
					title={label === "View" ? "View controls" : label}
					popoverTarget={id}
					className="flex h-8 min-w-6 shrink-0 items-center justify-center gap-1 bg-chrome-raised px-1 font-technical text-xs text-chrome-text hover:text-primary @[500px]:min-w-8 @[500px]:px-1.5"
				>
					<Icon icon={icon} width={16} height={16} />
					<span className="hidden @[900px]:inline">{label}</span>
				</button>
				<div
					id={id}
					popover="auto"
					aria-label={label}
					className="overflow-visible border border-chrome-border bg-void p-3 text-chrome-text shadow-xl"
					style={{ inset: "auto 12px 104px auto", margin: 0, maxWidth: "calc(100vw - 24px)" }}
				>
					{children}
				</div>
			</div>
		</>
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
	amplitudeLabel,
	disabled,
}: {
	readonly cursor: PointReadout;
	readonly selectionIn: PointReadout;
	readonly selectionOut: PointReadout;
	readonly amplitudeLabel?: string;
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
			className="grid items-baseline gap-x-3 gap-y-1 leading-none"
			style={{ gridTemplateColumns: "auto repeat(3, minmax(max-content, 1fr))" }}
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

			<span className={`${rowLabelClass} max-w-24 truncate`} title={amplitudeLabel}>
				{amplitudeLabel ?? "Amp"}
			</span>
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

export function Transport({
	control,
	volume,
	onVolumeChange,
	viewControls,
	playbackRate,
	onPlaybackRateChange,
	looping,
	onLoopingChange,
	sampleRate,
}: TransportProps) {
	const {
		disabled,
		playing,
		positionSec,
		durationSec,
		onPlayToggle,
		onSeek,
		cursorReadout,
		selectionInSec,
		selectionOutSec,
		selectionInAmp,
		selectionOutAmp,
		amplitudeLabel,
	} = control;

	const timecodeMainClass = disabled ? "text-chrome-text-dim" : "text-chrome-text";
	const timecodeSecondaryClass = disabled ? "text-chrome-text-dim" : "text-chrome-text-secondary";

	const selectionInLabel = selectionInSec !== undefined ? formatInspectionTime(selectionInSec * 1000) : "—";
	const selectionOutLabel = selectionOutSec !== undefined ? formatInspectionTime(selectionOutSec * 1000) : "—";

	return (
		<div role="region" aria-label="Transport" className="@container h-[92px] w-full bg-void">
			<div className="flex h-full min-w-0 items-center px-4">
				<div className="flex min-w-0 flex-1 basis-0 items-center">
					{viewControls && (
						<TransportCluster
							label="View"
							icon="lucide:sliders-horizontal"
							inlineClassName="hidden min-w-0 @[1280px]:block"
							compactClassName="shrink-0 @[1280px]:hidden"
						>
							<div className="[&_[role=listbox]]:bottom-full [&_[role=listbox]]:top-auto">{viewControls}</div>
						</TransportCluster>
					)}
				</div>

				<div className="mx-4 flex shrink-0 flex-col items-center justify-center gap-1.5">
					<div className="flex items-center gap-2">
						<div className="flex items-center">
							<MediaButton
								icon="lucide:skip-back"
								label="Skip to start"
								disabled={disabled}
								onClick={() => onSeek(0)}
							/>
							<MediaButton
								icon="lucide:chevrons-left"
								label="Jump back five seconds"
								disabled={disabled}
								onClick={() => onSeek(Math.max(0, positionSec - 5))}
							/>
							<MediaButton
								icon="lucide:chevron-left"
								label="Sample back"
								disabled={disabled}
								onClick={() => onSeek(Math.max(0, positionSec - 1 / sampleRate))}
							/>
							<MediaButton
								icon={<PlaybackGlyph playing={playing} />}
								label={playing ? "Pause" : "Play"}
								large
								active={playing}
								disabled={disabled}
								onClick={onPlayToggle}
							/>
							<MediaButton
								icon="lucide:chevron-right"
								label="Sample forward"
								disabled={disabled}
								onClick={() => onSeek(Math.min(durationSec, positionSec + 1 / sampleRate))}
							/>
							<MediaButton
								icon="lucide:chevrons-right"
								label="Jump forward five seconds"
								disabled={disabled}
								onClick={() => onSeek(Math.min(durationSec, positionSec + 5))}
							/>
							<MediaButton
								icon="lucide:skip-forward"
								label="Skip to end"
								disabled={disabled}
								onClick={() => onSeek(durationSec)}
							/>
						</div>
						<IconButton
							icon="lucide:repeat"
							label={looping ? "Disable loop" : "Loop selection or full stream"}
							size={16}
							variant="ghost"
							dim={!looping}
							disabled={disabled}
							onClick={() => onLoopingChange(!looping)}
						/>
					</div>

					<div className="flex items-center gap-3">
						<Select
							variant="chip"
							size="sm"
							direction="up"
							ariaLabel="Playback speed"
							className="shrink-0 italic [&_button]:normal-case [&_button]:tracking-normal"
							disabled={disabled}
							value={String(playbackRate)}
							options={PLAYBACK_RATE_OPTIONS}
							onChange={(value) => onPlaybackRateChange(Number(value))}
						/>
						<span
							className={`shrink-0 font-technical text-[length:var(--text-sm)] tabular-nums ${timecodeMainClass}`}
						>
							{formatTimecode(positionSec)}
							<span className={timecodeSecondaryClass}> / </span>
							<span className={timecodeSecondaryClass}>{formatTimecode(durationSec)}</span>
						</span>
					</div>
				</div>

				<div className="flex min-w-0 flex-1 basis-0 items-center">
					<div className="min-w-0 flex-1 @[1360px]:min-w-4" />
					<TransportCluster
						label="Measurements"
						icon="lucide:ruler"
						inlineClassName="hidden shrink-0 @[1360px]:block"
						compactClassName="shrink-0 @[1360px]:hidden"
					>
						<div className="max-w-[calc(100vw-48px)]">
							<ReadoutPanel
								amplitudeLabel={amplitudeLabel}
								cursor={{
									time: cursorReadout?.time ?? "—",
									freq: cursorReadout?.freq ?? "— Hz",
									amp: cursorReadout?.amp ?? "—",
								}}
								selectionIn={{
									time: selectionInLabel,
									amp: selectionInAmp ?? "—",
								}}
								selectionOut={{
									time: selectionOutLabel,
									amp: selectionOutAmp ?? "—",
								}}
								disabled={disabled}
							/>
						</div>
					</TransportCluster>
					<div className="min-w-0 flex-1 @[700px]:min-w-4" />
					<TransportCluster
						label="Volume"
						icon="lucide:volume-2"
						inlineClassName="hidden shrink-0 @[700px]:block"
						compactClassName="shrink-0 @[700px]:hidden"
					>
						<VolumeSlider volume={volume} onVolumeChange={onVolumeChange} />
					</TransportCluster>
				</div>
			</div>
		</div>
	);
}
