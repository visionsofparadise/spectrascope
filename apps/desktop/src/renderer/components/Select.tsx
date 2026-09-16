import { Icon } from "@iconify/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "../cn";

interface SelectOption {
	readonly value: string;
	readonly label: string;
}

interface SelectProps {
	readonly label?: string;
	readonly ariaLabel?: string;
	readonly value: string;
	readonly options: ReadonlyArray<SelectOption>;
	readonly onChange: (value: string) => void;
	readonly variant?: "field" | "chip";
	readonly direction?: "down" | "up";
	readonly size?: "sm" | "xs";
	readonly disabled?: boolean;
	readonly className?: string;
	readonly menuClassName?: string;
}

export function Select({
	label,
	ariaLabel,
	value,
	options,
	onChange,
	variant = "field",
	direction = "down",
	size = "xs",
	disabled,
	className,
	menuClassName,
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const listboxId = useId();
	const menuOpen = open && !disabled;
	const selectedIndex = Math.max(
		0,
		options.findIndex((option) => option.value === value),
	);

	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);

	useEffect(() => {
		if (menuOpen) optionRefs.current[selectedIndex]?.focus();
	}, [menuOpen, selectedIndex]);

	useEffect(() => {
		if (!menuOpen) return;

		const onPointerDown = (event: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				triggerRef.current?.focus();
			}
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);

		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [menuOpen]);

	const handleSelect = useCallback(
		(next: string) => {
			onChange(next);
			setOpen(false);
			triggerRef.current?.focus();
		},
		[onChange],
	);

	const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
		const lastIndex = options.length - 1;
		const nextIndex =
			event.key === "ArrowDown"
				? Math.min(lastIndex, index + 1)
				: event.key === "ArrowUp"
					? Math.max(0, index - 1)
					: event.key === "Home"
						? 0
						: event.key === "End"
							? lastIndex
							: undefined;

		if (nextIndex === undefined) return;

		event.preventDefault();
		optionRefs.current[nextIndex]?.focus();
	};

	const selected = options.find((option) => option.value === value);
	const displayLabel = selected?.label ?? value;

	const menu = menuOpen ? (
		<div
			id={listboxId}
			role="listbox"
			className={cn(
				"absolute left-0 z-50 flex flex-col bg-chrome-raised py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
				variant === "field" ? "right-0" : "min-w-full",
				direction === "up" ? "bottom-full mb-1" : "top-full mt-1",
				menuClassName,
			)}
		>
			{options.map((option, index) => {
				const isActive = option.value === value;

				return (
					<button
						key={option.value}
						ref={(element) => {
							optionRefs.current[index] = element;
						}}
						type="button"
						role="option"
						tabIndex={index === selectedIndex ? 0 : -1}
						onKeyDown={(event) => {
							handleOptionKeyDown(event, index);
						}}
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

	const trigger = (
		<button
			type="button"
			ref={triggerRef}
			aria-haspopup="listbox"
			aria-controls={listboxId}
			aria-label={ariaLabel ?? label}
			aria-expanded={menuOpen}
			onClick={() => {
				setOpen((previous) => !previous);
			}}
			disabled={disabled}
			className={
				variant === "field"
					? "flex w-full items-center justify-between gap-2 border border-chrome-border bg-void px-2 py-1.5 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text hover:border-chrome-text-dim"
					: cn(
							"flex max-w-full items-center px-1 py-0.5 font-technical uppercase tracking-[0.06em]",
							size === "sm" ? "text-[length:var(--text-sm)]" : "text-[length:var(--text-xs)]",
							disabled ? "cursor-not-allowed text-chrome-text-dim" : "text-chrome-text",
						)
			}
		>
			{variant === "field" ? (
				<>
					<span>{displayLabel}</span>
					<Icon icon="lucide:chevron-down" width={16} height={16} className="shrink-0 text-chrome-text-dim" />
				</>
			) : (
				<span
					className={cn(
						"flex min-w-0 items-center whitespace-nowrap bg-chrome-raised",
						size === "sm" ? "gap-1" : "gap-0.5",
					)}
				>
					<span className="truncate">{displayLabel}</span>
					<Icon
						icon="lucide:chevron-down"
						width={size === "sm" ? 14 : 12}
						height={size === "sm" ? 14 : 12}
						className="shrink-0"
					/>
				</span>
			)}
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
