import { majorTickIntervalMs } from "./timeTicks";
import type { GridMode } from "../viewSettings";

interface GridOverlayProps {
	readonly startMs: number;
	readonly endMs: number;
	readonly opacity: number;
	readonly mode?: GridMode;
}

export function GridOverlay({ startMs, endMs, opacity, mode }: GridOverlayProps) {
	const spanMs = endMs - startMs;

	const majorMs = majorTickIntervalMs(spanMs);

	const timeTicks: Array<number> = [];
	const first = Math.ceil(startMs / majorMs) * majorMs;

	for (let tick = first; tick <= endMs; tick += majorMs) {
		timeTicks.push((tick - startMs) / spanMs);
	}

	const hLines: Array<number> = [];

	if (mode === "freq") {
		const FREQ_MIN = 20;
		const FREQ_MAX = 22050;
		const melMin = 2595 * Math.log10(1 + FREQ_MIN / 700);
		const melMax = 2595 * Math.log10(1 + FREQ_MAX / 700);

		for (const hz of [100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
			const mel = 2595 * Math.log10(1 + hz / 700);

			hLines.push(1 - (mel - melMin) / (melMax - melMin));
		}
	} else if (mode === "amp") {
		const dbToLinear = (db: number) => Math.pow(10, db / 20);

		for (const db of [-3, -6, -12, -24]) {
			const amp = dbToLinear(db);

			hLines.push((1 - amp) * 0.5);
			hLines.push(0.5 + amp * 0.5);
		}

		hLines.push(0.5);
	}

	return (
		<div className="pointer-events-none absolute inset-0" style={{ opacity }}>
			{timeTicks.map((frac) => (
				<div
					key={`t${frac}`}
					className="absolute top-0 bottom-0 w-px bg-chrome-text"
					style={{ left: `${frac * 100}%` }}
				/>
			))}
			{hLines.map((frac, index) => (
				<div
					key={`h${index}`}
					className="absolute left-0 right-0 h-px bg-chrome-text"
					style={{ top: `${frac * 100}%` }}
				/>
			))}
		</div>
	);
}
