import { Icon } from "@iconify/react";
import { cn } from "../cn";

export function LoadingToast({
	label,
	fraction,
	className,
}: {
	readonly label: string;
	readonly fraction?: number;
	readonly className: string;
}) {
	return (
		<div
			role="status"
			className={cn(
				"pointer-events-none z-50 flex flex-col gap-1.5 bg-chrome-raised px-2.5 py-1.5 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
				className,
			)}
		>
			<div className="flex items-center gap-2">
				<Icon
					icon="lucide:loader-circle"
					width={14}
					height={14}
					className="shrink-0 animate-spin text-primary"
					style={{ animationDuration: "0.9s" }}
					aria-hidden="true"
				/>
				<span>{label}</span>
			</div>
			{fraction !== undefined && (
				<div className="h-0.5 w-full bg-chrome-border">
					<div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
				</div>
			)}
		</div>
	);
}
