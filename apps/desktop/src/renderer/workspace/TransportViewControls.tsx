import { Icon } from "@iconify/react";
import { Knob } from "../components/Knob";
import { Select } from "../components/Select";
import { FFT_OPTIONS, HOP_LABELS, HOP_OPTIONS, METRICS } from "./viewSettings";
import type { ViewControlSettings } from "./viewSettings";
import type { ViewId } from "./Workspace";

interface TransportViewControlsProps {
	readonly activeView: ViewId;
	readonly settings: ViewControlSettings;
	readonly onSettingsChange: (next: ViewControlSettings) => void;
	readonly syncEnabled: boolean;
	readonly onSyncEnabledChange: (next: boolean) => void;
}

const FFT_SELECT_OPTIONS = FFT_OPTIONS.map((value) => ({ value, label: value }));
const COLORMAP_OPTIONS = [
	{ value: "lava", label: "Lava" },
	{ value: "viridis", label: "Viridis" },
] as const;
const FREQUENCY_SCALE_OPTIONS = [
	{ value: "linear", label: "Linear" },
	{ value: "log", label: "Log" },
	{ value: "mel", label: "Mel" },
	{ value: "erb", label: "ERB" },
] as const;
const HOP_SELECT_OPTIONS = HOP_OPTIONS.map((value, index) => ({
	value,
	label: HOP_LABELS[index] ?? value,
}));
const METRIC_SELECT_OPTIONS = METRICS.map((metric) => ({
	value: metric.id,
	label: metric.label,
}));

const SAMPLING_OPTIONS = [
	{ value: 1, label: "1×" },
	{ value: 2, label: "2×" },
	{ value: 4, label: "4×" },
	{ value: 8, label: "8×" },
	{ value: "full", label: "Full" },
] as const;
const SAMPLING_SELECT_OPTIONS = SAMPLING_OPTIONS.map((option) => ({ ...option, value: String(option.value) }));
const SAMPLING_HELP =
	"Approximate overview: 1×, 2×, 4× and 8× choose the highest-RMS FFT window in each time subdivision of a pixel. Full uses every FFT window.";

function SamplingControl({
	settings,
	onSettingsChange,
}: Pick<TransportViewControlsProps, "settings" | "onSettingsChange">) {
	return (
		<div className="flex" title={SAMPLING_HELP}>
			<Select
				variant="chip"
				direction="up"
				ariaLabel="Spectrogram sampling"
				value={String(settings.spectrogramSampling)}
				options={SAMPLING_SELECT_OPTIONS}
				onChange={(value) => {
					const selected = SAMPLING_OPTIONS.find((option) => String(option.value) === value);

					if (selected) onSettingsChange({ ...settings, spectrogramSampling: selected.value });
				}}
			/>
		</div>
	);
}

function SpectrogramSelectors({
	settings,
	onSettingsChange,
}: Pick<TransportViewControlsProps, "settings" | "onSettingsChange">) {
	return (
		<div className="flex max-w-[150px] flex-wrap items-center gap-x-1 gap-y-0.5">
			<Select
				variant="chip"
				direction="up"
				value={settings.spectrogramColormap}
				ariaLabel="Colour map"
				options={COLORMAP_OPTIONS}
				onChange={(value) => {
					const selected = COLORMAP_OPTIONS.find((option) => option.value === value);

					if (selected) onSettingsChange({ ...settings, spectrogramColormap: selected.value });
				}}
			/>
			<SamplingControl settings={settings} onSettingsChange={onSettingsChange} />
			<div className="flex items-center gap-1">
				<Select
					variant="chip"
					direction="up"
					value={settings.frequencyScale}
					ariaLabel="Frequency scale"
					options={FREQUENCY_SCALE_OPTIONS}
					onChange={(value) => {
						const selected = FREQUENCY_SCALE_OPTIONS.find((option) => option.value === value);

						if (selected)
							onSettingsChange({
								...settings,
								frequencyScale: selected.value,
								frequencyRange: { top: 0, bottom: 1 },
							});
					}}
				/>
				<Select
					variant="chip"
					direction="up"
					value={String(settings.fftSize)}
					ariaLabel="FFT size"
					options={FFT_SELECT_OPTIONS}
					onChange={(value) => {
						onSettingsChange({ ...settings, fftSize: Number(value) });
					}}
				/>
				<Select
					variant="chip"
					direction="up"
					value={String(settings.hopOverlap)}
					ariaLabel="FFT hop"
					options={HOP_SELECT_OPTIONS}
					onChange={(value) => {
						onSettingsChange({ ...settings, hopOverlap: Number(value) });
					}}
				/>
			</div>
		</div>
	);
}

function KnobControl({
	value,
	icon,
	onChange,
}: {
	readonly value: number;
	readonly icon: string;
	readonly onChange: (next: number) => void;
}) {
	return (
		<div className="flex flex-col items-center gap-0.5">
			<Knob value={value} label="" size={24} hideValue onChange={onChange} />
			<Icon icon={icon} width={12} height={12} className="text-chrome-text-dim" />
		</div>
	);
}

function Divider() {
	return <div className="h-10 w-px bg-chrome-border-subtle" />;
}

function GridModeToggle({
	icon,
	label,
	active,
	onClick,
}: {
	readonly icon: string;
	readonly label: string;
	readonly active: boolean;
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			className={`flex items-center justify-center px-1 py-1.5 ${
				active ? "text-chrome-text" : "text-chrome-text-secondary hover:text-chrome-text"
			}`}
		>
			<Icon icon={icon} width={12} height={12} aria-hidden="true" />
		</button>
	);
}

function SyncToggle({
	enabled,
	onEnabledChange,
}: {
	readonly enabled: boolean;
	readonly onEnabledChange: (next: boolean) => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={enabled}
			aria-label={enabled ? "Disable cross-view sync" : "Enable cross-view sync"}
			onClick={() => {
				onEnabledChange(!enabled);
			}}
			className="flex shrink-0 items-center px-2 py-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text"
		>
			<span className={`flex items-center gap-1 ${enabled ? "bg-secondary text-chrome-text" : ""}`}>
				<Icon icon="lucide:link" width={14} height={14} aria-hidden="true" />
				<span>Sync</span>
			</span>
		</button>
	);
}

interface LayerOpacityKnobsProps {
	readonly settings: ViewControlSettings;
	readonly onSettingsChange: (next: ViewControlSettings) => void;
	readonly showSpectrogram?: boolean;
}

function LayerOpacityKnobs({ settings, onSettingsChange, showSpectrogram = true }: LayerOpacityKnobsProps) {
	return (
		<>
			<Divider />
			<KnobControl
				value={settings.waveformOpacity}
				icon="lucide:audio-waveform"
				onChange={(waveformOpacity) => {
					onSettingsChange({ ...settings, waveformOpacity });
				}}
			/>
			{showSpectrogram && (
				<>
					<Divider />
					<KnobControl
						value={settings.spectrogramOpacity}
						icon="lucide:flame"
						onChange={(spectrogramOpacity) => {
							onSettingsChange({ ...settings, spectrogramOpacity });
						}}
					/>
				</>
			)}
		</>
	);
}

export function TransportViewControls({
	activeView,
	settings,
	onSettingsChange,
	syncEnabled,
	onSyncEnabledChange,
}: TransportViewControlsProps) {
	const isLayerGroup =
		activeView === "overlay" || activeView === "slider" || activeView === "difference" || activeView === "sum";
	const showSpectrogram = activeView !== "overlay";

	if (isLayerGroup) {
		return (
			<div className="flex items-center gap-2.5">
				<SyncToggle enabled={syncEnabled} onEnabledChange={onSyncEnabledChange} />
				<KnobControl
					value={settings.gridOpacity}
					icon="lucide:grid-3x3"
					onChange={(gridOpacity) => {
						onSettingsChange({ ...settings, gridOpacity });
					}}
				/>
				{showSpectrogram && (
					<div className="flex items-center">
						<GridModeToggle
							icon="lucide:music"
							label="Frequency grid"
							active={settings.gridMode === "freq"}
							onClick={() => {
								onSettingsChange({ ...settings, gridMode: "freq" });
							}}
						/>
						<GridModeToggle
							icon="lucide:gauge"
							label="Amplitude grid"
							active={settings.gridMode === "amp"}
							onClick={() => {
								onSettingsChange({ ...settings, gridMode: "amp" });
							}}
						/>
					</div>
				)}

				<LayerOpacityKnobs
					settings={settings}
					onSettingsChange={onSettingsChange}
					showSpectrogram={showSpectrogram}
				/>
				{showSpectrogram && <SpectrogramSelectors settings={settings} onSettingsChange={onSettingsChange} />}
			</div>
		);
	}

	if (activeView === "timeline") {
		return (
			<div className="flex items-center gap-2.5">
				<KnobControl
					value={settings.gridOpacity}
					icon="lucide:grid-3x3"
					onChange={(gridOpacity) => {
						onSettingsChange({ ...settings, gridOpacity });
					}}
				/>
				<LayerOpacityKnobs settings={settings} onSettingsChange={onSettingsChange} />
				<SpectrogramSelectors settings={settings} onSettingsChange={onSettingsChange} />
			</div>
		);
	}

	if (activeView === "loudness") {
		return (
			<Select
				ariaLabel="Loudness metric"
				variant="chip"
				direction="up"
				menuClassName="w-40"
				value={settings.loudnessMetric}
				options={METRIC_SELECT_OPTIONS}
				onChange={(value) => {
					const metric = METRICS.find((entry) => entry.id === value);

					if (metric) onSettingsChange({ ...settings, loudnessMetric: metric.id });
				}}
			/>
		);
	}

	return null;
}
