export function ViewLoadingToast({
	label,
	color,
	fraction = 1,
}: {
	readonly label: string;
	readonly color?: string;
	readonly fraction?: number;
}) {
	return (
		<div role="status" className="pointer-events-none absolute top-0 right-0 z-40 flex flex-col items-stretch">
			<span className="bg-chrome-raised font-technical text-xs uppercase tracking-[0.06em] leading-[1.6] text-chrome-text">
				{label}
			</span>
			<span
				className="h-0.5"
				style={{
					background: color ?? "var(--color-primary)",
					width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
				}}
			/>
		</div>
	);
}
