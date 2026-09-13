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
	readonly sources: ReadonlyArray<Source>;
	readonly sourceStatus?: ReadonlyMap<string, SourceStreamStatus>;
	readonly sourceErrors?: ReadonlyMap<string, string>;
	readonly onRetrySource?: (sourceId: string) => void;
	readonly onRelinkSource?: (sourceId: string) => void;
	readonly onSourcesChange: (next: ReadonlyArray<Source>) => void;
}

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
	sources,
	sourceStatus,
	sourceErrors,
	onRetrySource,
	onRelinkSource,
	onSourcesChange,
}: SidebarProps) {
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

			<div className="min-h-0 flex-1">
				<SourcesPanel
					sources={sources}
					sourceStatus={sourceStatus}
					sourceErrors={sourceErrors}
					onRetrySource={onRetrySource}
					onRelinkSource={onRelinkSource}
					onChange={onSourcesChange}
				/>
			</div>
		</div>
	);
}
