import { Icon } from "@iconify/react";
import { Knob } from "../components/Knob";
import { Select } from "../components/Select";
import type { ViewId } from "./Workspace";
import {
	FFT_OPTIONS,
	HOP_LABELS,
	HOP_OPTIONS,
	METRICS,
} from "./viewSettings";
import type { ViewControlSettings } from "./viewSettings";

interface TransportViewControlsProps {
	readonly activeView: ViewId;
	readonly settings: ViewControlSettings;
	readonly onSettingsChange: (next: ViewControlSettings) => void;
	readonly syncEnabled: boolean;
	readonly onSyncEnabledChange: (next: boolean) => void;
}

/** Chip-Select option lists — stable module-scope references. */
const FFT_SELECT_OPTIONS = FFT_OPTIONS.map((value) => ({ value, label: value }));
const HOP_SELECT_OPTIONS = HOP_OPTIONS.map((value, index) => ({
	value,
	label: HOP_LABELS[index] ?? value,
}));
const MEL_SELECT_OPTIONS = [{ value: "mel", label: "Mel" }];
const METRIC_SELECT_OPTIONS = METRICS.map((metric) => ({
	value: metric.id,
	label: metric.label,
}));

const noop = () => {};

/** A knob with a glyph caption beneath it — the transport's opacity controls. */
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

/** Vertical divider between control groups. */
function Divider() {
	return <div className="h-10 w-px bg-chrome-border-subtle" />;
}

/**
 * Grid-mode toggle (freq / amp) — a chip-less, color-only icon button per the
 * v1 mockup (transport lines 375-376): the active mode reads `chrome-text`, the
 * inactive one `chrome-text-secondary` (brightening to `chrome-text` on hover).
 * No background chip — unlike `IconButton`, whose active state paints a
 * `chrome-raised` chip.
 */
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
				active
					? "text-chrome-text"
					: "text-chrome-text-secondary hover:text-chrome-text"
			}`}
		>
			<Icon icon={icon} width={12} height={12} aria-hidden="true" />
		</button>
	);
}

/**
 * SyncToggle — cross-view sync toggle (link glyph + "Sync"), hosted in the
 * transport's Timeline controls. Renders only in Timeline's controls per
 * the v1 design. Controlled — `enabled` / `onEnabledChange` owned by the host;
 * the flag drives the `SyncProvider` mounted around the workspace. Button
 * grammar: the outer button owns the padding, the inner span owns the
 * active-state `bg-secondary` chip and hugs its content.
 */
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
			<span
				className={`flex items-center gap-1 ${
					enabled ? "bg-secondary text-chrome-text" : ""
				}`}
			>
				<Icon icon="lucide:link" width={14} height={14} aria-hidden="true" />
				<span>Sync</span>
			</span>
		</button>
	);
}

/**
 * TransportViewControls — the active view's display-control cluster, rendered
 * into the transport's left region. The comparison host owns the shared
 * `settings` object and the `syncEnabled` flag; this component is the visual
 * cluster, emitting the next settings / sync state out.
 *
 * Per-view layout (per the v1 mockup):
 * - **Spectral group** (Overlay / Slider / Difference / Sum): grid-opacity knob
 *   + freq/amp grid-mode toggles, waveform and spectrogram opacity knobs, the
 *   Mel (stub) / FFT-size / hop-overlap chip selects (stacking vertically below
 *   1400px), and the loudness-opacity knob (still unconsumed — `SourceStrip`
 *   has no loudness layer).
 * - **Timeline**: the Sync toggle plus grid / waveform / spectrogram knobs (no
 *   FFT / Mel / loudness — Timeline has no frequency axis).
 * - **Loudness**: a labelled Metric field select that opens upward.
 * - **Correlation / Frequency Distribution / Vectorscope**: no controls.
 */
export function TransportViewControls({
	activeView,
	settings,
	onSettingsChange,
	syncEnabled,
	onSyncEnabledChange,
}: TransportViewControlsProps) {
	const isSpectralGroup =
		activeView === "overlay" ||
		activeView === "slider" ||
		activeView === "difference" ||
		activeView === "sum";

	if (isSpectralGroup) {
		return (
			<div className="flex items-center gap-3.5">
				<KnobControl
					value={settings.gridOpacity}
					icon="lucide:grid-3x3"
					onChange={(gridOpacity) => {
						onSettingsChange({ ...settings, gridOpacity });
					}}
				/>
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

				<Divider />
				<KnobControl
					value={settings.waveformOpacity}
					icon="lucide:audio-waveform"
					onChange={(waveformOpacity) => {
						onSettingsChange({ ...settings, waveformOpacity });
					}}
				/>
				<Divider />
				<KnobControl
					value={settings.spectrogramOpacity}
					icon="lucide:flame"
					onChange={(spectrogramOpacity) => {
						onSettingsChange({ ...settings, spectrogramOpacity });
					}}
				/>

				{/* Mel / FFT / hop chip selects — stack vertically below 1400px. */}
				<div className="flex flex-col items-stretch gap-0.5 min-[1400px]:flex-row min-[1400px]:items-center min-[1400px]:gap-1">
					{/* Mel is a stub — `frequencyScale` stays hardcoded mel in SourceStrip. */}
					<Select variant="chip" value="mel" options={MEL_SELECT_OPTIONS} onChange={noop} />
					<Select
						variant="chip"
						value={String(settings.fftSize)}
						options={FFT_SELECT_OPTIONS}
						onChange={(value) => {
							onSettingsChange({ ...settings, fftSize: Number(value) });
						}}
					/>
					<Select
						variant="chip"
						value={String(settings.hopOverlap)}
						options={HOP_SELECT_OPTIONS}
						onChange={(value) => {
							onSettingsChange({ ...settings, hopOverlap: Number(value) });
						}}
					/>
				</div>

				<Divider />
				<KnobControl
					value={settings.loudnessOpacity}
					icon="lucide:activity"
					onChange={(loudnessOpacity) => {
						onSettingsChange({ ...settings, loudnessOpacity });
					}}
				/>
			</div>
		);
	}

	if (activeView === "timeline") {
		return (
			<div className="flex items-center gap-3.5">
				<SyncToggle enabled={syncEnabled} onEnabledChange={onSyncEnabledChange} />
				<Divider />
				<KnobControl
					value={settings.gridOpacity}
					icon="lucide:grid-3x3"
					onChange={(gridOpacity) => {
						onSettingsChange({ ...settings, gridOpacity });
					}}
				/>
				<Divider />
				<KnobControl
					value={settings.waveformOpacity}
					icon="lucide:audio-waveform"
					onChange={(waveformOpacity) => {
						onSettingsChange({ ...settings, waveformOpacity });
					}}
				/>
				<Divider />
				<KnobControl
					value={settings.spectrogramOpacity}
					icon="lucide:flame"
					onChange={(spectrogramOpacity) => {
						onSettingsChange({ ...settings, spectrogramOpacity });
					}}
				/>
			</div>
		);
	}

	if (activeView === "loudness") {
		return (
			<Select
				label="Metric"
				variant="field"
				direction="up"
				className="w-40"
				value={settings.loudnessMetric}
				options={METRIC_SELECT_OPTIONS}
				onChange={(value) => {
					const metric = METRICS.find((entry) => entry.id === value);

					if (metric) onSettingsChange({ ...settings, loudnessMetric: metric.id });
				}}
			/>
		);
	}

	// Correlation, Frequency Distribution, Vectorscope — no display controls.
	return null;
}
