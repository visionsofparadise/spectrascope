import { frequencyToFraction } from "../utils/frequencyScale";
import { majorTickIntervalMs } from "./timeTicks";
import type { GridMode } from "../viewSettings";
import type { TextureVerticalRange } from "spectral-display";

interface GridOverlayProps {
	readonly startMs: number;
	readonly endMs: number;
	readonly opacity: number;
	readonly mode?: GridMode;
	readonly sampleRate?: number;
	readonly frequencyRange?: TextureVerticalRange;
}

export function GridOverlay({ startMs, endMs, opacity, mode, sampleRate = 48000, frequencyRange }: GridOverlayProps) {
	const spanMs = endMs - startMs;

	if (spanMs <= 0 || !Number.isFinite(spanMs)) return null;

	const majorMs = majorTickIntervalMs(spanMs);

	const timeTicks: Array<number> = [];
	const first = Math.ceil(startMs / majorMs) * majorMs;

	for (let tick = first; tick <= endMs; tick += majorMs) {
		timeTicks.push((tick - startMs) / spanMs);
	}

	const hLines: Array<number> = [];

	if (mode === "freq") {
		for (const hz of [100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
			const fraction = frequencyToFraction(hz, sampleRate, frequencyRange);

			if (fraction >= 0 && fraction <= 1) hLines.push(fraction);
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
