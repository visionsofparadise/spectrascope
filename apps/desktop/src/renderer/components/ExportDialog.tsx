import { useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import type { ExportControl, ExportKind, ExportRange } from "../export/ExportControl";

interface Props {
	readonly control: ExportControl;
	readonly onClose: () => void;
	readonly onExport: (kind: ExportKind, range: ExportRange) => void;
}

export function ExportDialog({ control, onClose, onExport }: Props) {
	const [kind, setKind] = useState<ExportKind>("png");
	const [range, setRange] = useState<ExportRange>(control.selection ? "selection" : "full");

	return (
		<Dialog title="Export" onClose={onClose}>
			<div className="flex flex-col gap-4">
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-2 text-chrome-text-secondary">Format</legend>
					{(["png", "wav", "csv"] as const).map((format) => (
						<label key={format} className="flex gap-2">
							<input
								type="radio"
								name="export-format"
								value={format}
								checked={kind === format}
								disabled={format !== "png" && control.streamKey === null}
								onChange={() => setKind(format)}
							/>
							{format === "png"
								? "PNG — current inspection view"
								: format === "wav"
									? "WAV — float32 audio"
									: "CSV — waveform measurements"}
						</label>
					))}
				</fieldset>
				{kind === "png" ? (
					<p className="text-sm text-chrome-text-secondary">
						Captures the visible inspection pane with its current zoom, colors, axes, and overlays.
					</p>
				) : (
					<>
						<p className="text-sm text-chrome-text-secondary">
							{control.streamLabel}. Uses the stream’s output channels at the session sample rate. Monitor volume
							and playback speed do not change the export.
						</p>
						{kind === "csv" && (
							<p className="text-sm text-chrome-text-secondary">
								Up to 1,000 intervals per channel with start/end seconds, minimum, maximum, and RMS amplitude.
								Values measure the output audio channels.
							</p>
						)}
						<fieldset className="flex gap-5">
							<legend className="mb-2 text-chrome-text-secondary">Range</legend>
							<label className="flex gap-2">
								<input
									type="radio"
									name="export-range"
									checked={range === "full"}
									onChange={() => setRange("full")}
								/>
								Full audio
							</label>
							<label className="flex gap-2">
								<input
									type="radio"
									name="export-range"
									disabled={!control.selection}
									checked={range === "selection"}
									onChange={() => setRange("selection")}
								/>
								Selection
							</label>
						</fieldset>
					</>
				)}
				<div className="mt-2 flex justify-end gap-3">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={() => onExport(kind, range)}>Choose destination…</Button>
				</div>
			</div>
		</Dialog>
	);
}
