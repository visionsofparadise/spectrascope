import { Icon } from "@iconify/react";
import { batch } from "opshot";
import { scope } from "opshot/react";
import { useCallback, useId, useRef, useState } from "react";
import { IconButton } from "../components/IconButton";
import { Select } from "../components/Select";
import { createGestureKey } from "../utils/gestureKey";
import type { SessionContext } from "../models/Context";
import type { ReactNode } from "react";

export interface TransportReadoutRow {
	readonly label: string;
	readonly cursor: string;
	readonly in: string;
	readonly out: string;
}

export interface TransportControl {
	readonly disabled?: boolean;
	readonly readoutRows: ReadonlyArray<TransportReadoutRow>;
}

interface TransportProps {
	readonly control: TransportControl;
	readonly sampleRate: number;
	readonly viewControls?: ReactNode;
	readonly context: SessionContext;
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
	const iconSize = large ? 24 : 20;

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
				className={`flex items-center justify-center ${large ? "size-6" : "size-5"} ${
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

function ReadoutPanel({
	rows,
	disabled,
}: {
	readonly rows: ReadonlyArray<TransportReadoutRow>;
	readonly disabled?: boolean;
}) {
	const labelClass = "font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim";
	const headClass = `w-19 shrink-0 text-right ${labelClass}`;
	const valueClass = `w-19 shrink-0 text-right font-technical text-[length:var(--text-sm)] tabular-nums ${
		disabled ? "text-chrome-text-dim" : "text-chrome-text"
	}`;

	return (
		<div className="flex shrink-0 flex-col gap-1">
			<div className="flex items-baseline gap-3 leading-none">
				<span className="w-11 shrink-0" />
				<span className={headClass}>Cursor</span>
				<span className={headClass}>In</span>
				<span className={headClass}>Out</span>
			</div>
			{rows.map((row) => (
				<div key={row.label} className="flex items-baseline gap-3 leading-none">
					<span className={`w-11 shrink-0 whitespace-nowrap ${labelClass}`}>{row.label}</span>
					<span className={valueClass}>{row.cursor}</span>
					<span className={valueClass}>{row.in}</span>
					<span className={valueClass}>{row.out}</span>
				</div>
			))}
		</div>
	);
}

function VolumeSlider({
	volume,
	onVolumeChange,
	onGestureEnd,
}: {
	readonly volume: number;
	readonly onVolumeChange: (volume: number) => void;
	readonly onGestureEnd: () => void;
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
				onPointerUp={onGestureEnd}
				onLostPointerCapture={onGestureEnd}
				onKeyDown={handleKeyDown}
				onKeyUp={onGestureEnd}
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

export const Transport = scope<TransportProps>(({ control, sampleRate, viewControls, context }: TransportProps) => {
	const { document, transport } = context.session;
	const { playback, playbackControls } = context;
	const { disabled, readoutRows } = control;
	const { playing, positionSec, durationSec } = playback;
	const { onPlayToggle, onSeek, onVolumeChange } = playbackControls;
	const [volumeGestureKey] = useState(createGestureKey);

	const handleVolumeChange = (volume: number): void => {
		batch(() => {
			document.volume = volume;
		}, volumeGestureKey.current());
		onVolumeChange(volume);
	};

	const timecodeMainClass = disabled ? "text-chrome-text-dim" : "text-chrome-text";
	const timecodeSecondaryClass = disabled ? "text-chrome-text-dim" : "text-chrome-text-secondary";

	return (
		<div role="region" aria-label="Transport" className="@container h-[92px] w-full bg-void">
			<div className="flex h-full min-w-0 items-center px-4">
				<div className="flex min-w-0 flex-1 basis-0 items-center overflow-x-clip">
					{viewControls && (
						<TransportCluster
							label="View"
							icon="lucide:sliders-horizontal"
							inlineClassName="hidden min-w-0 @[1360px]:block"
							compactClassName="shrink-0 @[1360px]:hidden"
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
							label={transport.looping ? "Disable loop" : "Loop selection or full stream"}
							size={16}
							variant="ghost"
							dim={!transport.looping}
							disabled={disabled}
							onClick={() => {
								transport.looping = !transport.looping;
							}}
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
							value={String(transport.playbackRate)}
							options={PLAYBACK_RATE_OPTIONS}
							onChange={(value) => {
								transport.playbackRate = Number(value);
							}}
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
					<div className="min-w-4 flex-1" />
					<ReadoutPanel rows={readoutRows} disabled={disabled} />
					<div className="min-w-0 flex-1 @[700px]:min-w-4" />
					<TransportCluster
						label="Volume"
						icon="lucide:volume-2"
						inlineClassName="hidden shrink-0 @[700px]:block"
						compactClassName="shrink-0 @[700px]:hidden"
					>
						<VolumeSlider
							volume={document.volume}
							onVolumeChange={handleVolumeChange}
							onGestureEnd={volumeGestureKey.end}
						/>
					</TransportCluster>
				</div>
			</div>
		</div>
	);
});
