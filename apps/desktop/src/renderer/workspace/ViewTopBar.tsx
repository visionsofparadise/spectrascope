import { Icon } from "@iconify/react";
import { useMemo } from "react";
import { Select } from "../components/Select";
import { NO_SOURCE, sourcePairOf } from "./views/sourcePair";
import { METRICS } from "./viewSettings";
import type { Source } from "./source";
import type { ViewControlSettings } from "./viewSettings";
import type { ViewId } from "./Workspace";
import type { ChannelInput, VectorscopeScale } from "spectral-display";

interface ViewTopBarProps {
	readonly activeView: ViewId;
	readonly onActiveViewChange: (id: ViewId) => void;
	readonly channelInput: ChannelInput;
	readonly onChannelInputChange: (next: ChannelInput) => void;
	readonly settings: ViewControlSettings;
	readonly onSettingsChange: (next: Partial<ViewControlSettings>) => void;
	readonly sources: ReadonlyArray<Source>;
	readonly differenceA: string | null;
	readonly differenceB: string | null;
	readonly onDifferenceChange: (differenceA: string | null, differenceB: string | null) => void;
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

const METRIC_OPTIONS = METRICS.map((metric) => ({ value: metric.id, label: metric.label }));

const SCALE_OPTIONS: ReadonlyArray<{ readonly value: VectorscopeScale; readonly label: string }> = [
	{ value: "linear", label: "Linear" },
	{ value: "sqrt", label: "Square root" },
	{ value: "log", label: "Logarithmic" },
];

const LABEL_CLASS = "font-technical text-xs uppercase tracking-[0.08em] text-chrome-text-secondary";

const doNothing = () => {};

function SyncToggle() {
	return (
		<button
			type="button"
			aria-pressed={false}
			onClick={doNothing}
			className="-mr-1 flex shrink-0 items-center px-1 py-0.5 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text"
		>
			<span className="flex items-center gap-1.5">
				<Icon icon="lucide:link" width={16} height={16} aria-hidden="true" />
				<span>Sync</span>
			</span>
		</button>
	);
}

function SourcePairSelects({
	sources,
	differenceA,
	differenceB,
	onDifferenceChange,
}: Pick<ViewTopBarProps, "sources" | "differenceA" | "differenceB" | "onDifferenceChange">) {
	const pair = useMemo(() => sourcePairOf(sources, differenceA, differenceB), [sources, differenceA, differenceB]);
	const options = useMemo(() => sources.map((source) => ({ value: source.id, label: source.name })), [sources]);
	const optionsB = useMemo(() => [...options, { value: NO_SOURCE, label: "None" }], [options]);

	if (pair.a === null) return null;

	const selectedA = pair.a;
	const selectedB = pair.b ?? NO_SOURCE;

	return (
		<div className="flex shrink-0 items-center gap-4">
			<div className="flex items-center gap-2">
				<span className={LABEL_CLASS}>A</span>
				<Select
					variant="chip"
					size="sm"
					ariaLabel="Source A"
					className="-mr-1 flex max-w-40"
					menuClassName="min-w-40"
					value={selectedA}
					options={options}
					onChange={(next) => onDifferenceChange(next, selectedB)}
				/>
			</div>
			<div className="flex items-center gap-2">
				<span className={LABEL_CLASS}>B</span>
				<Select
					variant="chip"
					size="sm"
					ariaLabel="Source B"
					className="-mr-1 flex max-w-40"
					menuClassName="right-0 left-auto min-w-40"
					value={selectedB}
					options={optionsB}
					onChange={(next) => onDifferenceChange(selectedA, next)}
				/>
			</div>
		</div>
	);
}

export function ViewTopBar({
	activeView,
	onActiveViewChange,
	channelInput,
	onChannelInputChange,
	settings,
	onSettingsChange,
	sources,
	differenceA,
	differenceB,
	onDifferenceChange,
}: ViewTopBarProps) {
	const showPair = activeView === "slider" || activeView === "sum" || activeView === "difference";

	return (
		<div className="flex shrink-0 items-center gap-5 bg-void px-4 py-2">
			<div className="flex items-center gap-2">
				<span className={LABEL_CLASS}>View</span>
				<Select
					variant="chip"
					size="sm"
					ariaLabel="View"
					className="-ml-1 flex max-w-40"
					menuClassName="min-w-40"
					value={activeView}
					options={VIEW_OPTIONS}
					onChange={(value) => {
						const option = VIEW_OPTIONS.find((entry) => entry.value === value);

						if (option) onActiveViewChange(option.value);
					}}
				/>
			</div>
			<div className="flex items-center gap-2">
				<span className={LABEL_CLASS}>Channels</span>
				<Select
					variant="chip"
					size="sm"
					ariaLabel="Channels"
					className="-ml-1 flex max-w-40"
					menuClassName="min-w-40"
					value={channelInput}
					options={CHANNEL_OPTIONS}
					onChange={(value) => {
						const option = CHANNEL_OPTIONS.find((entry) => entry.value === value);

						if (option) onChannelInputChange(option.value);
					}}
				/>
			</div>
			<div className="min-w-0 flex-1" />
			{activeView === "timeline" && <SyncToggle />}
			{activeView === "loudness" && (
				<div className="flex items-center gap-2">
					<span className={LABEL_CLASS}>Metric</span>
					<Select
						variant="chip"
						size="sm"
						ariaLabel="Loudness metric"
						className="-mr-1 flex"
						menuClassName="right-0 left-auto w-40"
						value={settings.loudnessMetric}
						options={METRIC_OPTIONS}
						onChange={(value) => {
							const metric = METRICS.find((entry) => entry.id === value);

							if (metric) onSettingsChange({ loudnessMetric: metric.id });
						}}
					/>
				</div>
			)}
			{activeView === "vectorscope" && (
				<div className="flex items-center gap-2">
					<span className={LABEL_CLASS}>Scale</span>
					<Select
						variant="chip"
						size="sm"
						ariaLabel="Vectorscope scale"
						className="-mr-1 flex"
						menuClassName="right-0 left-auto w-40"
						value={settings.vectorscopeScale}
						options={SCALE_OPTIONS}
						onChange={(value) => {
							const option = SCALE_OPTIONS.find((entry) => entry.value === value);

							if (option) onSettingsChange({ vectorscopeScale: option.value });
						}}
					/>
				</div>
			)}
			{showPair && (
				<SourcePairSelects
					sources={sources}
					differenceA={differenceA}
					differenceB={differenceB}
					onDifferenceChange={onDifferenceChange}
				/>
			)}
		</div>
	);
}
