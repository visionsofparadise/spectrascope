import { Icon } from "@iconify/react";
import { batch } from "opshot";
import { scope } from "opshot/react";
import { useState } from "react";
import { Knob } from "../components/Knob";
import { Select } from "../components/Select";
import { createGestureKey } from "../utils/gestureKey";
import { FFT_OPTIONS, HOP_LABELS, HOP_OPTIONS } from "./viewSettings";
import type { ViewId } from "./Workspace";
import type { SessionContext } from "../models/Context";
import type { RenderSettings } from "../models/State/Session";

interface TransportViewControlsProps {
	readonly context: SessionContext;
}

type OpacityLayer = "gridOpacity" | "waveformOpacity" | "spectrogramOpacity";

interface SettingsControlProps {
	readonly settings: RenderSettings;
	readonly onSettingsChange: (changes: Partial<RenderSettings>) => void;
}

const VIEW_CONTROL_VIEWS: ReadonlySet<ViewId> = new Set(["timeline", "overlay", "slider", "difference", "sum"]);

export function hasTransportViewControls(view: ViewId): boolean {
	return VIEW_CONTROL_VIEWS.has(view);
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

function SamplingControl({ settings, onSettingsChange }: SettingsControlProps) {
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

					if (selected) onSettingsChange({ spectrogramSampling: selected.value });
				}}
			/>
		</div>
	);
}

function SpectrogramSelectors({
	settings,
	onSettingsChange,
	onFrequencyScaleChange,
}: SettingsControlProps & { readonly onFrequencyScaleChange: (next: RenderSettings["frequencyScale"]) => void }) {
	return (
		<div className="flex items-center gap-1">
			<Select
				variant="chip"
				direction="up"
				value={settings.spectrogramColormap}
				ariaLabel="Colour map"
				options={COLORMAP_OPTIONS}
				onChange={(value) => {
					const selected = COLORMAP_OPTIONS.find((option) => option.value === value);

					if (selected) onSettingsChange({ spectrogramColormap: selected.value });
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

						if (selected) onFrequencyScaleChange(selected.value);
					}}
				/>
				<Select
					variant="chip"
					direction="up"
					value={String(settings.fftSize)}
					ariaLabel="FFT size"
					options={FFT_SELECT_OPTIONS}
					onChange={(value) => {
						onSettingsChange({ fftSize: Number(value) });
					}}
				/>
				<Select
					variant="chip"
					direction="up"
					value={String(settings.hopOverlap)}
					ariaLabel="FFT hop"
					options={HOP_SELECT_OPTIONS}
					onChange={(value) => {
						onSettingsChange({ hopOverlap: Number(value) });
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
	onChangeEnd,
}: {
	readonly value: number;
	readonly icon: string;
	readonly onChange: (next: number) => void;
	readonly onChangeEnd: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-0.5">
			<Knob value={value} label="" size={24} hideValue onChange={onChange} onChangeEnd={onChangeEnd} />
			<Icon icon={icon} width={16} height={16} className="text-chrome-text-dim" />
		</div>
	);
}

function Divider() {
	return <div className="h-11 w-px bg-chrome-border-subtle" />;
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
			<Icon icon={icon} width={16} height={16} aria-hidden="true" />
		</button>
	);
}

interface LayerOpacityKnobsProps {
	readonly settings: RenderSettings;
	readonly onOpacityChange: (layer: OpacityLayer, value: number) => void;
	readonly onOpacityEnd: (layer: OpacityLayer) => void;
	readonly showSpectrogram?: boolean;
}

function LayerOpacityKnobs({
	settings,
	onOpacityChange,
	onOpacityEnd,
	showSpectrogram = true,
}: LayerOpacityKnobsProps) {
	return (
		<>
			<Divider />
			<KnobControl
				value={settings.waveformOpacity}
				icon="lucide:audio-waveform"
				onChange={(value) => onOpacityChange("waveformOpacity", value)}
				onChangeEnd={() => onOpacityEnd("waveformOpacity")}
			/>
			{showSpectrogram && (
				<>
					<Divider />
					<KnobControl
						value={settings.spectrogramOpacity}
						icon="lucide:flame"
						onChange={(value) => onOpacityChange("spectrogramOpacity", value)}
						onChangeEnd={() => onOpacityEnd("spectrogramOpacity")}
					/>
				</>
			)}
		</>
	);
}

export const TransportViewControls = scope<TransportViewControlsProps>(({ context }: TransportViewControlsProps) => {
	const { document, navigation } = context.session;
	const { activeView } = navigation;
	const settings = document.renderSettings;
	const [opacityGestureKeys] = useState(() => ({
		gridOpacity: createGestureKey(),
		waveformOpacity: createGestureKey(),
		spectrogramOpacity: createGestureKey(),
	}));

	const onSettingsChange = (changes: Partial<RenderSettings>): void => {
		Object.assign(document.renderSettings, changes);
	};
	const onFrequencyScaleChange = (frequencyScale: RenderSettings["frequencyScale"]): void => {
		document.renderSettings.frequencyScale = frequencyScale;
		navigation.frequencyRange = { top: 0, bottom: 1 };
	};
	const onOpacityChange = (layer: OpacityLayer, value: number): void => {
		batch(() => {
			document.renderSettings[layer] = value;
		}, opacityGestureKeys[layer].current());
	};
	const onOpacityEnd = (layer: OpacityLayer): void => {
		opacityGestureKeys[layer].end();
	};
	const gridOpacityKnob = (
		<KnobControl
			value={settings.gridOpacity}
			icon="lucide:grid-3x3"
			onChange={(value) => onOpacityChange("gridOpacity", value)}
			onChangeEnd={() => onOpacityEnd("gridOpacity")}
		/>
	);
	const spectrogramSelectors = (
		<SpectrogramSelectors
			settings={settings}
			onSettingsChange={onSettingsChange}
			onFrequencyScaleChange={onFrequencyScaleChange}
		/>
	);
	const isLayerGroup =
		activeView === "overlay" || activeView === "slider" || activeView === "difference" || activeView === "sum";
	const showSpectrogram = activeView !== "overlay";

	if (isLayerGroup) {
		return (
			<div className="flex items-center gap-2.5">
				{gridOpacityKnob}
				{showSpectrogram && (
					<div className="flex items-center">
						<GridModeToggle
							icon="lucide:music"
							label="Frequency grid"
							active={settings.gridMode === "freq"}
							onClick={() => {
								onSettingsChange({ gridMode: "freq" });
							}}
						/>
						<GridModeToggle
							icon="lucide:gauge"
							label="Amplitude grid"
							active={settings.gridMode === "amp"}
							onClick={() => {
								onSettingsChange({ gridMode: "amp" });
							}}
						/>
					</div>
				)}

				<LayerOpacityKnobs
					settings={settings}
					onOpacityChange={onOpacityChange}
					onOpacityEnd={onOpacityEnd}
					showSpectrogram={showSpectrogram}
				/>
				{showSpectrogram && spectrogramSelectors}
			</div>
		);
	}

	if (activeView === "timeline") {
		return (
			<div className="flex items-center gap-2.5">
				{gridOpacityKnob}
				<LayerOpacityKnobs settings={settings} onOpacityChange={onOpacityChange} onOpacityEnd={onOpacityEnd} />
				{spectrogramSelectors}
			</div>
		);
	}

	return null;
});
