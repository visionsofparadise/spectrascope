// --- Frequency Axis (left side, fixed) ---

const FREQ_LABELS: ReadonlyArray<{ hz: number; label: string }> = [
	{ hz: 100, label: "100" },
	{ hz: 200, label: "200" },
	{ hz: 500, label: "500" },
	{ hz: 1000, label: "1k" },
	{ hz: 2000, label: "2k" },
	{ hz: 5000, label: "5k" },
	{ hz: 10000, label: "10k" },
	{ hz: 20000, label: "20k" },
];

const FREQ_MIN = 20;
const FREQ_MAX = 22050;

// Mel scale -- matches spectral-display package
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

// --- dB Axis Labels (right side of display, no colormap) ---

// Symmetric waveform amplitude axis: 0dB at top and bottom, -inf at center
// Position by linear amplitude: amplitude = 10^(dB/20), so -6dB ~= 0.5, -12dB ~= 0.25, etc.
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
			{/* Top half: 0dB near top -> approaching 50% center */}
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

			{/* Center: -inf */}
			<div className="absolute left-0 flex items-center" style={{ top: "50%", transform: "translateY(-50%)" }}>
				<span className="pl-1">−∞</span>
			</div>

			{/* Bottom half: mirror */}
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

// --- Time Ruler (top of display area) ---

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

	// Major tick interval (labeled)
	let majorMs = 5000;

	if (spanMs < 2000) majorMs = 200;
	else if (spanMs < 5000) majorMs = 500;
	else if (spanMs < 10000) majorMs = 1000;
	else if (spanMs < 30000) majorMs = 2000;
	else if (spanMs < 60000) majorMs = 5000;
	else majorMs = 10000;

	// Minor tick interval (unlabeled) -- subdivide major by 5 or 4
	const minorMs = majorMs <= 200 ? majorMs / 4 : majorMs / 5;

	// Collect major ticks
	const majorTicks: Array<{ timeMs: number; label: string }> = [];
	const firstMajor = Math.ceil(startMs / majorMs) * majorMs;

	for (let tick = firstMajor; tick <= endMs; tick += majorMs) {
		majorTicks.push({ timeMs: tick, label: formatRulerTime(tick) });
	}

	// Collect minor ticks (exclude positions that overlap with major)
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
			{/* Minor ticks — chrome-text-dim so they read on the void background.
          `chrome-border` is a panel-divider value and is far too dark to be
          visible against `bg-void`. */}
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

			{/* Major ticks with labels — chrome-text-secondary, matching the tick
          labels so a labelled tick reads as one unit. */}
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

// --- Linear dB Axis (left side, single-direction linear scale) ---

interface LinearDbAxisProps {
	/** dB tick values to label. Top = highest value, bottom = lowest. */
	readonly ticks: ReadonlyArray<number>;
	/** Width of the axis column. Defaults to `2.5rem` (matches FreqDist precedent). */
	readonly width?: string;
}

/**
 * Single-direction linear dB axis. Top = first entry in `ticks`, bottom = last
 * entry. Used by chart views (FrequencyDistributionView, LoudnessView) where
 * the Y axis is a single signed dB range rather than the symmetric waveform-
 * amplitude axis the spectrogram `DbAxis` represents.
 *
 * Promoted to a shared helper in Phase 9 — second use of the same orientation.
 * Inline copies in `FrequencyDistributionView` previously; both views now
 * consume this. The tick values are caller-owned so each view picks its own
 * dB range (FreqDist: 0 → -90; Loudness: 0 → -60).
 */
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
