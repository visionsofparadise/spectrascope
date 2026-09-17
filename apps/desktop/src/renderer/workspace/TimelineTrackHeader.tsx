import { Icon } from "@iconify/react";
import { useState } from "react";
import { cn } from "../cn";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../components/DropdownMenu";
import { IconButton } from "../components/IconButton";
import { LayerColorPicker } from "./LayerColorPicker";
import type { Source } from "./source";
import type { SourceState } from "../models/State/App";

export interface TimelineOffsetHandle {
	readonly valueMaxMs: number;
	readonly onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
	readonly onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

interface TimelineTrackHeaderProps {
	readonly source: Source;
	readonly top: string;
	readonly offsetMs: number;
	readonly offsetHandle?: TimelineOffsetHandle;
	readonly onSourceChange?: (changes: Partial<SourceState>) => void;
	readonly onRelink?: () => void;
	readonly onRemove?: () => void;
}

const CHIP_CLASS =
	"bg-chrome-raised font-technical text-xs uppercase tracking-[0.06em] leading-[1.6] text-chrome-text whitespace-nowrap";

export function TimelineTrackHeader({
	source,
	top,
	offsetMs,
	offsetHandle,
	onSourceChange,
	onRelink,
	onRemove,
}: TimelineTrackHeaderProps) {
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<div className="absolute left-0 z-10 flex items-center gap-1" style={{ top }}>
			{offsetHandle ? (
				<button
					type="button"
					role="slider"
					aria-label={`Timeline offset for ${source.name}`}
					aria-valuemin={0}
					aria-valuemax={Math.round(offsetHandle.valueMaxMs)}
					aria-valuenow={Math.round(offsetMs)}
					aria-valuetext={`${(offsetMs / 1000).toFixed(2)} seconds`}
					onPointerDown={offsetHandle.onPointerDown}
					onKeyDown={offsetHandle.onKeyDown}
					className={cn(
						CHIP_CLASS,
						"cursor-ew-resize outline-none focus-visible:ring-1 focus-visible:ring-primary",
					)}
				>
					{source.name}
				</button>
			) : (
				<span className={CHIP_CLASS}>{source.name}</span>
			)}
			<IconButton
				icon={source.visible ? "lucide:eye" : "lucide:eye-off"}
				label={source.visible ? "Hide source" : "Show source"}
				className="p-0.5"
				active={source.visible}
				activeVariant="secondary"
				aria-pressed={source.visible}
				onClick={() => onSourceChange?.({ visible: !source.visible })}
			/>
			<IconButton
				icon={source.muted ? "lucide:volume-x" : "lucide:volume-2"}
				label={source.muted ? "Unmute source" : "Mute source"}
				className="p-0.5"
				active={!source.muted}
				activeVariant="secondary"
				aria-pressed={!source.muted}
				onClick={() => onSourceChange?.({ muted: !source.muted })}
			/>
			<IconButton
				icon="lucide:headphones"
				label={source.soloed ? "Unsolo source" : "Solo source"}
				className="p-0.5"
				active={source.soloed}
				activeVariant="secondary"
				aria-pressed={source.soloed}
				onClick={() => onSourceChange?.({ soloed: !source.soloed })}
			/>
			<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label="Source actions"
						className="flex items-center justify-center p-0.5 text-chrome-text-secondary outline-none hover:text-chrome-text"
					>
						<span className="flex items-center justify-center bg-chrome-raised">
							<Icon icon="lucide:more-horizontal" width={16} height={16} aria-hidden="true" />
						</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>Layer colour</DropdownMenuSubTrigger>
						<DropdownMenuSubContent aria-label="Layer colour">
							<LayerColorPicker
								value={source.layerColor}
								onChange={(layerColor) => {
									onSourceChange?.({ layerColor });
									setMenuOpen(false);
								}}
							/>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					{onRelink && <DropdownMenuItem onSelect={onRelink}>Replace audio…</DropdownMenuItem>}
					<DropdownMenuItem disabled className="text-chrome-text-dim" onSelect={(event) => event.preventDefault()}>
						Duplicate
					</DropdownMenuItem>
					{onRemove && (
						<DropdownMenuItem
							onSelect={onRemove}
							className="text-state-error data-[highlighted]:text-state-error"
						>
							Remove source
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
