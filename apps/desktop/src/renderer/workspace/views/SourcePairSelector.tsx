import { useMemo } from "react";
import { Select } from "../../components/Select";
import type { Source } from "../source";
import type { SourcePair } from "./sourcePair";

const LABEL_CLASS =
	"font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-secondary";

export function SourcePairSelector({
	sources,
	pair,
	operator,
	onPairChange,
}: {
	readonly sources: ReadonlyArray<Source>;
	readonly pair: SourcePair;
	readonly operator?: string;
	readonly onPairChange: (differenceA: string, differenceB: string) => void;
}) {
	const options = useMemo(() => sources.map((source) => ({ value: source.id, label: source.name })), [sources]);

	if (pair.a === null) return null;

	const selectedA = pair.a;
	const selectedB = pair.b;

	return (
		<div className="flex shrink-0 items-center gap-4 bg-void px-3 py-1.5">
			<div className="flex items-center gap-1.5">
				<span className={LABEL_CLASS}>A</span>
				<Select
					variant="chip"
					ariaLabel="Source A"
					value={selectedA}
					options={options}
					onChange={(next) => onPairChange(next, selectedB ?? next)}
				/>
			</div>
			{selectedB !== null && (
				<>
					{operator && (
						<span aria-hidden className="font-technical text-[length:var(--text-sm)] text-chrome-text-dim">
							{operator}
						</span>
					)}
					<div className="flex items-center gap-1.5">
						<span className={LABEL_CLASS}>B</span>
						<Select
							variant="chip"
							ariaLabel="Source B"
							value={selectedB}
							options={options}
							onChange={(next) => onPairChange(selectedA, next)}
						/>
					</div>
				</>
			)}
		</div>
	);
}
