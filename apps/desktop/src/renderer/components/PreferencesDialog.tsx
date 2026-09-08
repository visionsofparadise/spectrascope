import { INITIAL_PREFERENCES, type Preferences } from "../models/State/App";
import { FFT_OPTIONS, HOP_OPTIONS } from "../workspace/viewSettings";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface Props {
	readonly preferences: Preferences;
	readonly theme: "lava" | "viridis";
	readonly onPreferencesChange: (value: Preferences) => void;
	readonly onThemeChange: (value: "lava" | "viridis") => void;
	readonly onClose: () => void;
}

const FIELD = "border border-chrome-border bg-chrome-raised px-2 py-1 text-chrome-text";

export function PreferencesDialog({ preferences, theme, onPreferencesChange, onThemeChange, onClose }: Props) {
	return (
		<Dialog title="Preferences" onClose={onClose}>
			<div className="flex flex-col gap-4">
				<label className="flex items-center justify-between gap-4">
					Theme
					<select
						className={FIELD}
						value={theme}
						onChange={(event) => onThemeChange(event.target.value === "viridis" ? "viridis" : "lava")}
					>
						<option value="lava">Lava</option>
						<option value="viridis">Viridis</option>
					</select>
				</label>
				<p className="text-sm text-chrome-text-secondary">
					Defaults below apply to new sessions. Existing sessions keep their saved settings.
				</p>
				<label className="flex items-center justify-between gap-4">
					Sample rate
					<select
						className={FIELD}
						value={preferences.sampleRate ?? "auto"}
						onChange={(event) =>
							onPreferencesChange({
								...preferences,
								sampleRate: event.target.value === "auto" ? null : Number(event.target.value),
							})
						}
					>
						<option value="auto">First source</option>
						{Array.from(
							new Set([
								22050,
								44100,
								48000,
								88200,
								96000,
								192000,
								...(preferences.sampleRate === null ? [] : [preferences.sampleRate]),
							]),
						)
							.sort((left, right) => left - right)
							.map((rate) => (
								<option key={rate} value={rate}>
									{rate.toLocaleString()} Hz
								</option>
							))}
					</select>
				</label>
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
				<label className="flex items-center justify-between gap-4">
					Playback speed
					<select
						className={FIELD}
						value={preferences.playbackRate}
						onChange={(event) =>
							onPreferencesChange({ ...preferences, playbackRate: Number(event.target.value) })
						}
					>
						{Array.from(new Set([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, preferences.playbackRate]))
							.sort((left, right) => left - right)
							.map((rate) => (
								<option key={rate} value={rate}>
									{rate}×
								</option>
							))}
					</select>
				</label>
				<label className="flex items-center justify-between gap-4">
					FFT size
					<select
						className={FIELD}
						value={preferences.fftSize}
						onChange={(event) => onPreferencesChange({ ...preferences, fftSize: Number(event.target.value) })}
					>
						{FFT_OPTIONS.map((size) => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center justify-between gap-4">
					FFT hop
					<select
						className={FIELD}
						value={preferences.hopOverlap}
						onChange={(event) => onPreferencesChange({ ...preferences, hopOverlap: Number(event.target.value) })}
					>
						{HOP_OPTIONS.map((hop) => (
							<option key={hop} value={hop}>
								1/{hop}
							</option>
						))}
					</select>
				</label>
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
