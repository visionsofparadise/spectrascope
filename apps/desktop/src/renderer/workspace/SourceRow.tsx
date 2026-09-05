import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../cn";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../components/DropdownMenu";
import { IconButton } from "../components/IconButton";
import { LayerColorPicker } from "./LayerColorPicker";
import type { LayerColor } from "./layers";
import type { Source } from "./source";
import type { SourceStreamStatus } from "../audio/useSourceStreams";

interface SourceRowProps {
	readonly source: Source;
	/**
	 * The source's stream-preparation status. `preparing` dims the row and shows
	 * a spinner; `error` tints the filename in the error tone with the failure
	 * reason on hover. `ready` / undefined render normally.
	 */
	readonly status?: SourceStreamStatus;
	readonly onChange: (next: Source) => void;
	readonly onRemove: () => void;
	readonly active?: boolean;
	readonly onActivate?: () => void;
}

function fileNameOf(source: Source): string {
	const segment = source.audioFilePath
		.replace(/[/\\]+$/, "")
		.split(/[/\\]/)
		.pop();

	return segment && segment.length > 0 ? segment : source.name;
}

export function SourceRow({ source, status, onChange, onRemove, active, onActivate }: SourceRowProps) {
	const [pickerOpen, setPickerOpen] = useState(false);

	const rowRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!pickerOpen) return;

		function handlePointer(event: PointerEvent) {
			if (rowRef.current && !rowRef.current.contains(event.target as Node)) {
				setPickerOpen(false);
			}
		}

		window.addEventListener("pointerdown", handlePointer);

		return () => {
			window.removeEventListener("pointerdown", handlePointer);
		};
	}, [pickerOpen]);

	function applyLayerColor(next: LayerColor): void {
		onChange({ ...source, layerColor: next });
	}

	const label = fileNameOf(source);

	return (
		<div
			ref={rowRef}
			className={cn(
				"group relative flex flex-row items-start gap-3 p-3",
				"hover:bg-interactive-hover",
				status === "preparing" && "opacity-60",
				active === true && "bg-interactive-hover",
				active === true &&
					"before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-data-cursor",
			)}
			onClick={() => onActivate?.()}
			role={onActivate ? "button" : undefined}
			tabIndex={onActivate ? 0 : undefined}
		>
			<div className="relative shrink-0">
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						setPickerOpen((prev) => !prev);
					}}
					aria-label="Edit layer color"
					aria-haspopup="dialog"
					aria-expanded={pickerOpen}
					className="relative block h-7 w-7 shrink-0 outline-none focus:ring-1 focus:ring-primary"
					style={{ backgroundColor: source.layerColor.primary }}
				>
					<span
						aria-hidden
						className="absolute right-0 top-0 bottom-0"
						style={{ width: 5, backgroundColor: source.layerColor.secondary }}
					/>
				</button>
				{pickerOpen && (
					<div
						className="absolute left-0 top-full z-50 mt-1 bg-chrome-raised p-2"
						onClick={(event) => event.stopPropagation()}
						role="dialog"
					>
						<LayerColorPicker
							value={source.layerColor}
							onChange={(next) => {
								applyLayerColor(next);
								setPickerOpen(false);
							}}
						/>
					</div>
				)}
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 items-center gap-1.5">
					<span
						className={cn(
							"min-w-0 truncate font-body text-base font-medium leading-tight",
							status === "error" ? "text-state-error" : "text-chrome-text",
						)}
						title={status === "error" ? "Failed to prepare audio" : source.audioFilePath || label}
					>
						{label}
					</span>
					{status === "preparing" && (
						<Icon
							icon="lucide:loader-2"
							width={14}
							height={14}
							className="shrink-0 animate-spin text-chrome-text-dim"
							aria-label="Preparing"
						/>
					)}
					{status === "error" && (
						<Icon
							icon="lucide:alert-triangle"
							width={14}
							height={14}
							className="shrink-0 text-state-error"
							aria-label="Preparation failed"
						/>
					)}
				</div>

				<div className="min-w-0">
					<span
						className="block min-w-0 overflow-hidden truncate font-body text-xs text-chrome-text-dim"
						style={{ direction: "rtl", textAlign: "left" }}
						title={source.audioFilePath}
					>
						‎{source.audioFilePath || " "}
					</span>
				</div>

				<div className="flex items-center gap-1 pt-1">
					<IconButton
						icon={source.visible ? "lucide:eye" : "lucide:eye-off"}
						label={source.visible ? "Hide source" : "Show source"}
						size={16}
						active={source.visible}
						activeVariant="secondary"
						aria-pressed={source.visible}
						onClick={(event) => {
							event.stopPropagation();
							onChange({ ...source, visible: !source.visible });
						}}
					/>

					<IconButton
						icon={source.muted ? "lucide:volume-x" : "lucide:volume-2"}
						label={source.muted ? "Unmute source" : "Mute source"}
						size={16}
						active={!source.muted}
						activeVariant="secondary"
						aria-pressed={!source.muted}
						onClick={(event) => {
							event.stopPropagation();
							onChange({ ...source, muted: !source.muted });
						}}
					/>

					<IconButton
						icon="lucide:headphones"
						label={source.soloed ? "Unsolo source" : "Solo source"}
						size={16}
						active={source.soloed}
						activeVariant="secondary"
						aria-pressed={source.soloed}
						onClick={(event) => {
							event.stopPropagation();
							onChange({ ...source, soloed: !source.soloed });
						}}
					/>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								onClick={(event) => event.stopPropagation()}
								aria-label="Source actions"
								className="flex items-center justify-center px-1 py-1.5 text-chrome-text-secondary outline-none hover:text-chrome-text"
							>
								<span className="flex items-center justify-center bg-chrome-raised">
									<Icon icon="lucide:more-horizontal" width={18} height={18} aria-hidden="true" />
								</span>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuItem
								disabled
								className="text-chrome-text-dim"
								onSelect={(event) => event.preventDefault()}
							>
								Duplicate
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={(event) => {
									event.preventDefault();
									onRemove();
								}}
								className="text-state-error data-[highlighted]:text-state-error"
							>
								Remove source
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</div>
	);
}
