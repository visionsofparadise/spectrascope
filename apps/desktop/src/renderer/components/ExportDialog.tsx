import { useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Select } from "./Select";
import type { ExportControl, ExportKind, ExportRange } from "../export/ExportControl";

const FORMAT_OPTIONS: ReadonlyArray<{ readonly value: ExportKind; readonly label: string }> = [
	{ value: "png", label: "PNG — current inspection view" },
	{ value: "wav", label: "WAV — float32 audio" },
	{ value: "csv", label: "CSV — waveform measurements" },
];

const RANGE_OPTIONS: ReadonlyArray<{ readonly value: ExportRange; readonly label: string }> = [
	{ value: "full", label: "Full audio" },
	{ value: "selection", label: "Selection" },
];

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
				<div className="flex items-center justify-between gap-4">
					Format
					<Select
						variant="chip"
						size="sm"
						ariaLabel="Format"
						className="-mr-1 flex"
						menuClassName="right-0 left-auto min-w-40"
						value={kind}
						options={FORMAT_OPTIONS.filter((option) => option.value === "png" || control.streamKey !== null)}
						onChange={(value) => {
							const option = FORMAT_OPTIONS.find((entry) => entry.value === value);

							if (option) setKind(option.value);
						}}
					/>
				</div>
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
						<div className="flex items-center justify-between gap-4">
							Range
							<Select
								variant="chip"
								size="sm"
								ariaLabel="Range"
								className="-mr-1 flex"
								menuClassName="right-0 left-auto min-w-40"
								value={range}
								options={RANGE_OPTIONS.filter((option) => option.value === "full" || control.selection)}
								onChange={(value) => setRange(value === "selection" ? "selection" : "full")}
							/>
						</div>
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
