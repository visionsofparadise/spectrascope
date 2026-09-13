import { axisFractionOf, FULL_AXIS_RANGE } from "../utils/axisRange";
import { formatInspectionTime } from "../utils/formatInspectionTime";
import { frequencyToFraction } from "../utils/frequencyScale";
import { verticalFractionOf } from "../utils/verticalRange";
import { SelectionSurface } from "./SelectionSurface";
import { FREQUENCY_TICK_LABELS, majorTickIntervalMs } from "./timeTicks";
import { visibleValueTicksOf } from "./valueTicks";
import type { AxisRange } from "../utils/axisRange";
import type { FrequencyScale } from "spectral-display";
import type { TextureVerticalRange } from "spectral-display";

const FREQ_LABELS = FREQUENCY_TICK_LABELS.filter((tick) => tick.hz >= 100);

interface FrequencyAxisProps {
	readonly sampleRate: number;
	readonly frequencyScale?: FrequencyScale;
	readonly frequencyRange?: TextureVerticalRange;
}

export function FrequencyAxis({ sampleRate, frequencyRange, frequencyScale = "mel" }: FrequencyAxisProps) {
	return (
		<div
			className="relative bg-void font-technical text-chrome-text-secondary"
			style={{
				fontSize: "var(--text-xs)",
				letterSpacing: "0.02em",
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{FREQ_LABELS.filter(({ hz }) => hz <= sampleRate / 2).map(({ hz, label }) => {
				const yPct = frequencyToFraction(hz, sampleRate, frequencyRange, frequencyScale) * 100;

				if (yPct < 0 || yPct > 100) return null;

				return (
					<div
						key={hz}
						className="absolute right-0 flex items-center"
						style={{ top: `${yPct}%`, transform: "translateY(-50%)" }}
					>
						<span className="pr-1">{label}</span>
					</div>
				);
			})}
		</div>
	);
}

const DB_HALF_LABELS = [0, -3, -6, -12, -24];

function dbToLinear(db: number): number {
	return Math.pow(10, db / 20);
}

export function DbAxis({ verticalRange }: { readonly verticalRange?: TextureVerticalRange }) {
	const ticks = DB_HALF_LABELS.flatMap((db) => {
		const amplitude = dbToLinear(db);

		return [
			{ key: `t${db}`, label: String(db), fraction: (1 - amplitude) / 2 },
			{ key: `b${db}`, label: String(db), fraction: (1 + amplitude) / 2 },
		];
	}).concat({ key: "zero", label: "−∞", fraction: 0.5 });

	return (
		<div
			className="relative w-8 bg-void font-technical text-chrome-text-secondary"
			style={{
				fontSize: "var(--text-xs)",
				letterSpacing: "0.02em",
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{ticks.map((tick) => {
				const position = verticalFractionOf(tick.fraction, verticalRange);

				if (position < 0 || position > 1) return null;

				return (
					<div
						key={tick.key}
						className="absolute left-0 flex items-center"
						style={{
							top: `${position * 100}%`,
							transform: position === 0 ? undefined : position === 1 ? "translateY(-100%)" : "translateY(-50%)",
						}}
					>
						<span className="pl-1">{tick.label}</span>
					</div>
				);
			})}
		</div>
	);
}

interface TimeRulerProps {
	readonly startMs: number;
	readonly endMs: number;
}

function formatRulerTime(ms: number, majorMs: number): string {
	const precision = Math.max(1, Math.min(6, -Math.floor(Math.log10(majorMs / 1000))));

	return formatInspectionTime(ms, precision);
}

export function TimeRuler({ startMs, endMs }: TimeRulerProps) {
	const spanMs = endMs - startMs;

	const majorMs = majorTickIntervalMs(spanMs);

	const minorMs = majorMs <= 200 ? majorMs / 4 : majorMs / 5;

	const majorTicks: Array<{ timeMs: number; label: string }> = [];
	const firstMajor = Math.ceil(startMs / majorMs) * majorMs;

	for (let tick = firstMajor; spanMs > 0 && tick <= endMs; tick += majorMs) {
		majorTicks.push({ timeMs: tick, label: formatRulerTime(tick, majorMs) });
	}

	const minorTicks: Array<number> = [];
	const firstMinor = Math.ceil(startMs / minorMs) * minorMs;

	for (let tick = firstMinor; spanMs > 0 && tick <= endMs; tick += minorMs) {
		if (Math.abs(tick / majorMs - Math.round(tick / majorMs)) > 0.000001) {
			minorTicks.push(tick);
		}
	}

	return (
		<SelectionSurface
			startMs={startMs}
			endMs={endMs}
			seekOnClick
			aria-label="Timeline ruler: click to seek, Shift-drag to select"
			className="relative h-8 cursor-crosshair bg-void font-technical text-chrome-text-secondary"
			style={{
				fontSize: "var(--text-xs)",
				letterSpacing: "0.02em",
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{minorTicks.map((timeMs) => {
				const fraction = (timeMs - startMs) / spanMs;

				return (
					<div
						key={`m${timeMs}`}
						className="absolute bottom-0 h-1.5 w-px bg-chrome-text-dim"
						style={{ left: `${fraction * 100}%` }}
					/>
				);
			})}

			{majorTicks.map(({ timeMs, label }) => {
				const fraction = (timeMs - startMs) / spanMs;

				return (
					<div key={timeMs} className="absolute bottom-0" style={{ left: `${fraction * 100}%` }}>
						<span className="absolute bottom-0 left-0 h-2.5 w-px bg-chrome-text-secondary" />
						<span className="absolute bottom-0.5 left-1.5">{label}</span>
					</div>
				);
			})}
		</SelectionSurface>
	);
}

interface LinearDbAxisProps {
	readonly min: number;
	readonly max: number;
	readonly tickCount: number;
	readonly range?: AxisRange;
	readonly width?: string;
}

export function LinearDbAxis({ min, max, tickCount, range = FULL_AXIS_RANGE, width = "2.5rem" }: LinearDbAxisProps) {
	const span = max - min;

	return (
		<div
			className="relative h-full bg-void font-technical text-chrome-text-secondary"
			style={{
				width,
				fontSize: "var(--text-xs)",
				letterSpacing: "0.02em",
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{visibleValueTicksOf(min, max, range, tickCount).map((value) => {
				const position = span > 0 ? axisFractionOf((max - value) / span, range) : 0;

				if (position < 0 || position > 1) return null;

				return (
					<div
						key={value}
						className="absolute right-0 flex items-center"
						style={{ top: `${position * 100}%`, transform: "translateY(-50%)" }}
					>
						<span className="pr-1">{value}</span>
					</div>
				);
			})}
		</div>
	);
}
