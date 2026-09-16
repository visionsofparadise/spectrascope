import { INITIAL_PREFERENCES, type Preferences } from "../models/State/App";
import { FFT_OPTIONS, HOP_OPTIONS } from "../workspace/viewSettings";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Select } from "./Select";
import type { ThemeId } from "../utils/themePalettes";

interface Props {
	readonly preferences: Preferences;
	readonly theme: ThemeId;
	readonly onPreferencesChange: (value: Preferences) => void;
	readonly onThemeChange: (value: ThemeId) => void;
	readonly onClose: () => void;
}

const THEME_OPTIONS = [
	{ value: "lava", label: "Lava" },
	{ value: "viridis", label: "Viridis" },
] as const;
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const FFT_SELECT_OPTIONS = FFT_OPTIONS.map((size) => ({ value: size, label: size }));
const HOP_SELECT_OPTIONS = HOP_OPTIONS.map((hop) => ({ value: hop, label: `1/${hop}` }));

function PreferenceSelect({
	label,
	value,
	options,
	onChange,
}: {
	readonly label: string;
	readonly value: string;
	readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
	readonly onChange: (value: string) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			{label}
			<Select
				variant="chip"
				size="sm"
				ariaLabel={label}
				className="-mr-1 flex"
				menuClassName="right-0 left-auto min-w-40"
				value={value}
				options={options}
				onChange={onChange}
			/>
		</div>
	);
}

export function PreferencesDialog({ preferences, theme, onPreferencesChange, onThemeChange, onClose }: Props) {
	return (
		<Dialog title="Preferences" onClose={onClose}>
			<div className="flex flex-col gap-4">
				<PreferenceSelect
					label="Theme"
					value={theme}
					options={THEME_OPTIONS}
					onChange={(value) => onThemeChange(value === "viridis" ? "viridis" : "lava")}
				/>
				<p className="text-sm text-chrome-text-secondary">
					Defaults below apply to new sessions. Existing sessions keep their saved settings.
				</p>
				<label className="flex items-center justify-between gap-4">
					Monitor volume: {Math.round(preferences.monitorVolume * 100)}%
					<input
						className="accent-primary"
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={preferences.monitorVolume}
						onChange={(event) =>
							onPreferencesChange({ ...preferences, monitorVolume: Number(event.target.value) })
						}
					/>
				</label>
				<PreferenceSelect
					label="Playback speed"
					value={String(preferences.playbackRate)}
					options={Array.from(new Set([...PLAYBACK_RATES, preferences.playbackRate]))
						.sort((left, right) => left - right)
						.map((rate) => ({ value: String(rate), label: `${rate}×` }))}
					onChange={(value) => onPreferencesChange({ ...preferences, playbackRate: Number(value) })}
				/>
				<PreferenceSelect
					label="FFT size"
					value={String(preferences.fftSize)}
					options={FFT_SELECT_OPTIONS}
					onChange={(value) => onPreferencesChange({ ...preferences, fftSize: Number(value) })}
				/>
				<PreferenceSelect
					label="FFT hop"
					value={String(preferences.hopOverlap)}
					options={HOP_SELECT_OPTIONS}
					onChange={(value) => onPreferencesChange({ ...preferences, hopOverlap: Number(value) })}
				/>
				<div className="mt-2 flex justify-between">
					<Button
						variant="secondary"
						onClick={() => {
							onPreferencesChange({ ...INITIAL_PREFERENCES });
							onThemeChange("lava");
						}}
					>
						Reset defaults
					</Button>
					<Button onClick={onClose}>Done</Button>
				</div>
			</div>
		</Dialog>
	);
}
