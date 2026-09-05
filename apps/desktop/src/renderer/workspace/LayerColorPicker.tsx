import { Icon } from "@iconify/react";
import { useState } from "react";
import { cn } from "../cn";
import { DEFAULT_LAYER_PALETTE } from "./layers";
import type { LayerColor } from "./layers";

interface LayerColorPickerProps {
	readonly value: LayerColor;
	readonly onChange: (next: LayerColor) => void;
	readonly palette?: ReadonlyArray<LayerColor>;
}

function isSameLayerColor(left: LayerColor, right: LayerColor): boolean {
	return (
		left.primary.toLowerCase() === right.primary.toLowerCase() &&
		left.secondary.toLowerCase() === right.secondary.toLowerCase()
	);
}

interface SwatchProps {
	readonly layer: LayerColor;
	readonly active: boolean;
	readonly onClick: () => void;
}

function Swatch({ layer, active, onClick }: SwatchProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={`Layer color ${layer.primary} / ${layer.secondary}`}
			className={cn("relative h-4 w-4 shrink-0 outline-none", active && "ring-1 ring-primary")}
			style={{ backgroundColor: layer.primary }}
		>
			<span
				aria-hidden
				className="absolute right-0 top-0 bottom-0"
				style={{ width: 3, backgroundColor: layer.secondary }}
			/>
		</button>
	);
}

interface CustomSwatchProps {
	readonly active: boolean;
	readonly value: LayerColor;
	readonly onApply: (next: LayerColor) => void;
}

function CustomSwatch({ active, value, onApply }: CustomSwatchProps) {
	const [open, setOpen] = useState(false);
	const [primary, setPrimary] = useState(value.primary);
	const [secondary, setSecondary] = useState(value.secondary);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => {
					setPrimary(value.primary);
					setSecondary(value.secondary);
					setOpen((prev) => !prev);
				}}
				aria-label="Custom layer color"
				className={cn(
					"relative flex h-4 w-4 shrink-0 items-center justify-center bg-chrome-raised text-chrome-text-secondary outline-none hover:text-chrome-text",
					active && "ring-1 ring-primary",
				)}
			>
				<Icon icon="lucide:plus" width={10} height={10} aria-hidden="true" />
			</button>
			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 flex flex-col gap-2 bg-chrome-raised p-3">
					<div className="flex flex-col gap-1">
						<label className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
							Primary
						</label>
						<input
							type="color"
							value={primary}
							onChange={(event) => setPrimary(event.target.value)}
							className="h-6 w-12 cursor-pointer bg-void p-0 outline-none"
						/>
					</div>
					<div className="flex flex-col gap-1">
						<label className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
							Secondary
						</label>
						<input
							type="color"
							value={secondary}
							onChange={(event) => setSecondary(event.target.value)}
							className="h-6 w-12 cursor-pointer bg-void p-0 outline-none"
						/>
					</div>
					<button
						type="button"
						onClick={() => {
							onApply({ primary, secondary });
							setOpen(false);
						}}
						className="bg-primary px-2 py-1 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-void hover:bg-primary"
					>
						Apply
					</button>
				</div>
			)}
		</div>
	);
}

export function LayerColorPicker({ value, onChange, palette = DEFAULT_LAYER_PALETTE }: LayerColorPickerProps) {
	const matchesPaletteEntry = palette.some((entry) => isSameLayerColor(entry, value));

	return (
		<div className="flex items-center gap-1">
			{palette.map((layer, index) => (
				<Swatch
					key={`${layer.primary}-${layer.secondary}-${String(index)}`}
					layer={layer}
					active={isSameLayerColor(layer, value)}
					onClick={() => onChange(layer)}
				/>
			))}
			<CustomSwatch active={!matchesPaletteEntry} value={value} onApply={onChange} />
		</div>
	);
}
