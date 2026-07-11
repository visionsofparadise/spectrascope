import type { ChannelInput } from "spectral-display";
import { Select } from "../components/Select";
import type { SourceStreamStatus } from "../audio/useSourceStreams";
import { SourcesPanel } from "./SourcesPanel";
import type { Source } from "./source";
import type { ViewId } from "./Workspace";

interface SidebarProps {
	readonly activeView: ViewId;
	readonly onActiveViewChange: (id: ViewId) => void;
	/** The global Mono/Mid/Side channel-input mode (persisted on the comparison). */
	readonly channelInput: ChannelInput;
	readonly onChannelInputChange: (next: ChannelInput) => void;
	/** The comparison's canonical sample rate, or `null` until the first source captures it. */
	readonly canonicalSampleRate: number | null;
	readonly onSampleRateChange: (rate: number) => void;
	readonly sources: ReadonlyArray<Source>;
	/** Per-source preparation status keyed by `Source.id`, for the row progress/error treatment. */
	readonly sourceStatus?: ReadonlyMap<string, SourceStreamStatus>;
	readonly onSourcesChange: (next: ReadonlyArray<Source>) => void;
}

/** The standard sample rates offered by the Rate selector; a captured nonstandard rate is appended. */
const STANDARD_SAMPLE_RATES: ReadonlyArray<number> = [44100, 48000, 88200, 96000, 176400, 192000];

/** Placeholder shown in the Rate selector before a rate has been captured. */
const RATE_UNSET_LABEL = "—";

/**
 * The nine views the View selector offers, in the mockup's `tabDefs` order and
 * with its display labels ("Freq Dist" for frequency-distribution). `value` is
 * the code's `ViewId`; `label` is the display text.
 */
const VIEW_OPTIONS: ReadonlyArray<{ readonly value: ViewId; readonly label: string }> = [
	{ value: "timeline", label: "Timeline" },
	{ value: "overlay", label: "Overlay" },
	{ value: "slider", label: "Slider" },
	{ value: "difference", label: "Difference" },
	{ value: "sum", label: "Sum" },
	{ value: "frequency-distribution", label: "Freq Dist" },
	{ value: "loudness", label: "Loudness" },
	{ value: "correlation", label: "Correlation" },
	{ value: "vectorscope", label: "Vectorscope" },
];

/**
 * The three channel-input modes. There is no "Stereo" option — a spectrogram
 * input is always a single channel, so the modes are the three derived signals
 * Mono / Mid / Side.
 */
const CHANNEL_OPTIONS: ReadonlyArray<{ readonly value: ChannelInput; readonly label: string }> = [
	{ value: "mono", label: "Mono" },
	{ value: "mid", label: "Mid" },
	{ value: "side", label: "Side" },
];

/**
 * Sidebar — the workspace shell's left column. Two labelled field selectors —
 * View (which of the nine views is shown) and Channels (the global Mono/Mid/Side
 * spectrogram input) — over the `SourcesPanel`, which fills the rest. Controlled:
 * owns no state; the comparison host owns the active view, channel input, and
 * source list, and each selector emits its next value out.
 */
export function Sidebar({
	activeView,
	onActiveViewChange,
	channelInput,
	onChannelInputChange,
	canonicalSampleRate,
	onSampleRateChange,
	sources,
	sourceStatus,
	onSourcesChange,
}: SidebarProps) {
	// Standard rates, plus the captured rate itself when it is nonstandard, so the
	// current value always has a matching option. `value` is the code's number as
	// a string; `label` is the same number displayed.
	const rateValues =
		canonicalSampleRate !== null && !STANDARD_SAMPLE_RATES.includes(canonicalSampleRate)
			? [...STANDARD_SAMPLE_RATES, canonicalSampleRate]
			: STANDARD_SAMPLE_RATES;

	const rateOptions = rateValues.map((rate) => ({ value: String(rate), label: String(rate) }));

	return (
		<div className="flex h-full flex-col bg-void">
			<div className="flex flex-col gap-1.5 px-4 py-3">
				<span className="font-technical text-xs uppercase tracking-[0.08em] text-chrome-text-secondary">
					View
				</span>
				<Select
					value={activeView}
					options={VIEW_OPTIONS}
					onChange={(value) => {
						const option = VIEW_OPTIONS.find((entry) => entry.value === value);

						if (option) onActiveViewChange(option.value);
					}}
				/>
			</div>

			<div className="flex flex-col gap-1.5 px-4 py-3">
				<span className="font-technical text-xs uppercase tracking-[0.08em] text-chrome-text-secondary">
					Channels
				</span>
				<Select
					value={channelInput}
					options={CHANNEL_OPTIONS}
					onChange={(value) => {
						const option = CHANNEL_OPTIONS.find((entry) => entry.value === value);

						if (option) onChannelInputChange(option.value);
					}}
				/>
			</div>

			<div className="flex flex-col gap-1.5 px-4 py-3">
				<span className="font-technical text-xs uppercase tracking-[0.08em] text-chrome-text-secondary">
					Rate
				</span>
				<Select
					value={canonicalSampleRate === null ? RATE_UNSET_LABEL : String(canonicalSampleRate)}
					options={rateOptions}
					onChange={(value) => {
						const rate = Number(value);

						if (Number.isFinite(rate) && rate > 0) onSampleRateChange(rate);
					}}
				/>
			</div>

			<div className="min-h-0 flex-1">
				<SourcesPanel sources={sources} sourceStatus={sourceStatus} onChange={onSourcesChange} />
			</div>
		</div>
	);
}
