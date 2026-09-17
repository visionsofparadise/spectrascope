import { scope } from "opshot/react";
import type { SessionContext } from "../../models/Context";

interface PlayheadProps {
	readonly startMs: number;
	readonly endMs: number;
	readonly context: SessionContext;
}

export const Playhead = scope<PlayheadProps>(({ startMs, endMs, context }: PlayheadProps) => {
	const { playback } = context;
	const positionSec = playback.positionSec;
	const fraction = (positionSec * 1000 - startMs) / (endMs - startMs);

	if (endMs <= startMs || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;

	return (
		<div
			aria-hidden="true"
			data-playhead={positionSec}
			className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-data-cursor"
			style={{ left: `${fraction * 100}%` }}
		/>
	);
});
