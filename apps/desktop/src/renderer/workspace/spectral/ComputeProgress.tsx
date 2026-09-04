export interface ComputeProgressProps {
	/**
	 * First-compute completion `0..1`. Omit for the shimmer-only affordance (the
	 * minimaps, which carry no bar per the v1 language).
	 */
	readonly fraction?: number;
}

/**
 * First-compute affordance: a chrome-toned diagonal shimmer over the area that
 * will render, plus an optional centered progress bar. Decorative only —
 * `pointer-events-none`, so gestures pass through to the canvas beneath.
 */
export function ComputeProgress({ fraction }: ComputeProgressProps) {
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<div className="compute-shimmer absolute inset-0" />
			{fraction !== undefined && (
				<div className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-chrome-border">
					<div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
				</div>
			)}
		</div>
	);
}
