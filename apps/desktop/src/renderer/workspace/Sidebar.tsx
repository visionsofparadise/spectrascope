import { Select } from "../components/Select";
import { SourcesPanel } from "./SourcesPanel";
import type { Source } from "./source";
import type { ViewId } from "./Workspace";
import type { SourceStreamStatus } from "../audio/useSourceStreams";
import type { ChannelInput } from "spectral-display";

interface SidebarProps {
	readonly activeView: ViewId;
	readonly onActiveViewChange: (id: ViewId) => void;
	readonly channelInput: ChannelInput;
	readonly onChannelInputChange: (next: ChannelInput) => void;
	readonly canonicalSampleRate: number | null;
	readonly onSampleRateChange: (rate: number) => void;
	readonly sources: ReadonlyArray<Source>;
	readonly sourceStatus?: ReadonlyMap<string, SourceStreamStatus>;
	readonly onSourcesChange: (next: ReadonlyArray<Source>) => void;
}

const STANDARD_SAMPLE_RATES: ReadonlyArray<number> = [44100, 48000, 88200, 96000, 176400, 192000];

const RATE_UNSET_LABEL = "—";

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

const CHANNEL_OPTIONS: ReadonlyArray<{ readonly value: ChannelInput; readonly label: string }> = [
	{ value: "mono", label: "Mono" },
	{ value: "mid", label: "Mid" },
	{ value: "side", label: "Side" },
];

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
	const rateValues =
		canonicalSampleRate !== null && !STANDARD_SAMPLE_RATES.includes(canonicalSampleRate)
			? [...STANDARD_SAMPLE_RATES, canonicalSampleRate]
			: STANDARD_SAMPLE_RATES;

	const rateOptions = rateValues.map((rate) => ({ value: String(rate), label: String(rate) }));

	return (
		<div className="flex h-full flex-col bg-void">
			<div className="flex flex-col gap-1.5 px-4 py-3">
				<span className="font-technical text-xs uppercase tracking-[0.08em] text-chrome-text-secondary">View</span>
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
				<span className="font-technical text-xs uppercase tracking-[0.08em] text-chrome-text-secondary">Rate</span>
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
