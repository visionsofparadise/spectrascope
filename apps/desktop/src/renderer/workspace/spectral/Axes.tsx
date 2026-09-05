import { FREQUENCY_TICK_LABELS, majorTickIntervalMs } from "./timeTicks";

const FREQ_LABELS = FREQUENCY_TICK_LABELS.filter((tick) => tick.hz >= 100);

const FREQ_MIN = 20;
const FREQ_MAX = 22050;

function freqToMel(hz: number): number {
	return 2595 * Math.log10(1 + hz / 700);
}

function freqToY(hz: number): number {
	const melMin = freqToMel(FREQ_MIN);
	const melMax = freqToMel(FREQ_MAX);
	const melHz = freqToMel(hz);

	return 1 - (melHz - melMin) / (melMax - melMin);
}

export function FrequencyAxis() {
	return (
		<div
			className="relative bg-void font-technical text-chrome-text-secondary"
			style={{
				fontSize: "var(--text-xs)",
				letterSpacing: "0.02em",
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{FREQ_LABELS.map(({ hz, label }) => {
				const yPct = freqToY(hz) * 100;

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

export function DbAxis() {
	return (
		<div
			className="relative w-8 bg-void font-technical text-chrome-text-secondary"
			style={{
				fontSize: "var(--text-xs)",
				letterSpacing: "0.02em",
				fontVariantNumeric: "tabular-nums",
			}}
		>
			{DB_HALF_LABELS.map((db) => {
				const amp = db === 0 ? 1 : dbToLinear(db);
				const yPct = (1 - amp) * 50;

				return (
					<div
						key={`t${db}`}
						className="absolute left-0 flex items-center"
						style={{
							top: db === 0 ? "0px" : `${yPct}%`,
							transform: db === 0 ? undefined : "translateY(-50%)",
						}}
					>
						<span className="pl-1">{db}</span>
					</div>
				);
			})}

			<div className="absolute left-0 flex items-center" style={{ top: "50%", transform: "translateY(-50%)" }}>
				<span className="pl-1">−∞</span>
			</div>

			{DB_HALF_LABELS.map((db) => {
				const amp = db === 0 ? 1 : dbToLinear(db);
				const yPct = 50 + amp * 50;

				return (
					<div
						key={`b${db}`}
						className="absolute left-0 flex items-center"
						style={{
							bottom: db === 0 ? "0px" : undefined,
							top: db === 0 ? undefined : `${yPct}%`,
							transform: db === 0 ? undefined : "translateY(-50%)",
						}}
					>
						<span className="pl-1">{db}</span>
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

function formatRulerTime(ms: number): string {
	const totalSeconds = ms / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const frac = Math.floor((totalSeconds * 10) % 10);

	return `${minutes}:${seconds.toString().padStart(2, "0")}.${frac}`;
}

export function TimeRuler({ startMs, endMs }: TimeRulerProps) {
	const spanMs = endMs - startMs;

	const majorMs = majorTickIntervalMs(spanMs);

	const minorMs = majorMs <= 200 ? majorMs / 4 : majorMs / 5;

	const majorTicks: Array<{ timeMs: number; label: string }> = [];
	const firstMajor = Math.ceil(startMs / majorMs) * majorMs;

	for (let tick = firstMajor; tick <= endMs; tick += majorMs) {
		majorTicks.push({ timeMs: tick, label: formatRulerTime(tick) });
	}

	const minorTicks: Array<number> = [];
	const firstMinor = Math.ceil(startMs / minorMs) * minorMs;

	for (let tick = firstMinor; tick <= endMs; tick += minorMs) {
		if (tick % majorMs !== 0) {
			minorTicks.push(tick);
		}
	}

	return (
		<div
			className="relative h-8 bg-void font-technical text-chrome-text-secondary"
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

			<div className="absolute bottom-0 left-0 right-0 h-px bg-chrome-border" />
		</div>
	);
}

interface LinearDbAxisProps {
	readonly ticks: ReadonlyArray<number>;
	readonly width?: string;
}

export function LinearDbAxis({ ticks, width = "2.5rem" }: LinearDbAxisProps) {
	const dbMax = ticks[0] ?? 0;
	const dbMin = ticks[ticks.length - 1] ?? -90;
	const dbRange = dbMax - dbMin;

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
			{ticks.map((db) => {
				const yPct = dbRange > 0 ? ((dbMax - db) / dbRange) * 100 : 0;

				return (
					<div
						key={db}
						className="absolute right-0 flex items-center"
						style={{ top: `${yPct}%`, transform: "translateY(-50%)" }}
					>
						<span className="pr-1">{db}</span>
					</div>
				);
			})}
		</div>
	);
}
