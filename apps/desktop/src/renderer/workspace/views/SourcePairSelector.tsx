import { useMemo } from "react";
import { Select } from "../../components/Select";
import { NO_SOURCE, type SourcePair } from "./sourcePair";
import type { Source } from "../source";

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
	const optionsB = useMemo(() => [...options, { value: NO_SOURCE, label: "None" }], [options]);

	if (pair.a === null) return null;

	const selectedA = pair.a;
	const selectedB = pair.b ?? NO_SOURCE;

	return (
		<div className="flex shrink-0 items-center gap-4 bg-void px-3 py-1.5">
			<div className="flex items-center gap-1.5">
				<span className={LABEL_CLASS}>A</span>
				<Select
					variant="chip"
					ariaLabel="Source A"
					value={selectedA}
					options={options}
					onChange={(next) => onPairChange(next, selectedB)}
				/>
			</div>
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
					options={optionsB}
					onChange={(next) => onPairChange(selectedA, next)}
				/>
			</div>
		</div>
	);
}
