import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../cn";

interface SelectOption {
	readonly value: string;
	readonly label: string;
}

interface SelectProps {
	/** Optional caption rendered above the trigger (field variant). */
	readonly label?: string;
	readonly value: string;
	readonly options: ReadonlyArray<SelectOption>;
	readonly onChange: (value: string) => void;
	/**
	 * `"field"` — a bordered full-width trigger on `void` (the sidebar / Loudness
	 * metric selectors). `"chip"` — a compact `chrome-raised` chip (the
	 * transport's FFT / hop / Mel controls).
	 */
	readonly variant?: "field" | "chip";
	/** Whether the menu opens below (`"down"`, default) or above (`"up"`). */
	readonly direction?: "down" | "up";
	readonly className?: string;
}

/**
 * Select — the v1 dropdown-select. A trigger (bordered field or raised chip)
 * over a shadowed menu whose active option is drawn in `primary`. Closes on
 * select, on an outside pointerdown, and on Escape. Not a menu of actions
 * (that is `DropdownMenu`); it picks one value from a fixed option list, so it
 * carries `role="listbox"` / `role="option"` and no animation.
 */
export function Select({
	label,
	value,
	options,
	onChange,
	variant = "field",
	direction = "down",
	className,
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;

		const onPointerDown = (event: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);

		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const handleSelect = useCallback(
		(next: string) => {
			onChange(next);
			setOpen(false);
		},
		[onChange],
	);

	const selected = options.find((option) => option.value === value);
	const displayLabel = selected?.label ?? value;

	const menu = open ? (
		<div
			role="listbox"
			className={cn(
				"absolute left-0 z-50 flex flex-col bg-chrome-raised py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
				variant === "field" ? "right-0" : "min-w-full",
				direction === "up" ? "bottom-full mb-1" : "top-full mt-1",
			)}
		>
			{options.map((option) => {
				const isActive = option.value === value;

				return (
					<button
						key={option.value}
						type="button"
						role="option"
						aria-selected={isActive}
						onClick={() => {
							handleSelect(option.value);
						}}
						className={cn(
							"whitespace-nowrap px-3 py-1.5 text-left font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] hover:bg-interactive-hover",
							isActive ? "text-primary" : "text-chrome-text",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	) : null;

	const trigger =
		variant === "field" ? (
			<button
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => {
					setOpen((prev) => !prev);
				}}
				className="flex w-full items-center justify-between gap-2 border border-chrome-border bg-void px-2 py-1.5 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text hover:border-chrome-text-dim"
			>
				<span>{displayLabel}</span>
				<Icon
					icon="lucide:chevron-down"
					width={14}
					height={14}
					className="shrink-0 text-chrome-text-dim"
				/>
			</button>
		) : (
			<button
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => {
					setOpen((prev) => !prev);
				}}
				className="flex items-center px-1 py-0.5 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text"
			>
				{/* Chip grammar — the outer button owns the padding; the inner
				    span carries the `chrome-raised` chip and hugs its content. */}
				<span className="flex items-center gap-0.5 bg-chrome-raised">
					<span>{displayLabel}</span>
					<Icon icon="lucide:chevron-down" width={10} height={10} />
				</span>
			</button>
		);

	if (label) {
		return (
			<div ref={rootRef} className={cn("relative flex flex-col gap-1", className)}>
				<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-secondary">
					{label}
				</span>
				{trigger}
				{menu}
			</div>
		);
	}

	return (
		<div ref={rootRef} className={cn("relative", className)}>
			{trigger}
			{menu}
		</div>
	);
}
