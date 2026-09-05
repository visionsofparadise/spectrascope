import { Icon } from "@iconify/react";
import { Button } from "../components/Button";
import { createDefaultSource } from "./source";
import { SourceRow } from "./SourceRow";
import type { Source } from "./source";
import type { SourceStreamStatus } from "../audio/useSourceStreams";

interface SourcesPanelProps {
	readonly sources: ReadonlyArray<Source>;
	readonly onChange: (next: ReadonlyArray<Source>) => void;
	readonly sourceStatus?: ReadonlyMap<string, SourceStreamStatus>;
	readonly activeSourceId?: string;
	readonly onActiveSourceChange?: (id: string) => void;
}

export function SourcesPanel({
	sources,
	onChange,
	sourceStatus,
	activeSourceId,
	onActiveSourceChange,
}: SourcesPanelProps) {
	function replaceSource(next: Source): void {
		const updated = sources.map((source) => (source.id === next.id ? next : source));

		onChange(updated);
	}

	function removeSource(id: string): void {
		const updated = sources.filter((source) => source.id !== id);

		onChange(updated);

		if (onActiveSourceChange && activeSourceId === id) {
			const fallback = updated[0]?.id;

			if (fallback !== undefined) {
				onActiveSourceChange(fallback);
			}
		}
	}

	function addSource(): void {
		const next = createDefaultSource(sources.length);

		onChange([...sources, next]);
	}

	return (
		<div className="flex h-full flex-col bg-void">
			<div className="flex h-10 shrink-0 items-center px-4">
				<span className="font-technical text-xs uppercase tracking-[0.08em] text-chrome-text-secondary">
					Sources
				</span>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<ul className="flex flex-col">
					{sources.map((source) => (
						<li key={source.id}>
							<SourceRow
								source={source}
								status={sourceStatus?.get(source.id)}
								onChange={replaceSource}
								onRemove={() => removeSource(source.id)}
								active={source.id === activeSourceId}
								onActivate={onActiveSourceChange ? () => onActiveSourceChange(source.id) : undefined}
							/>
						</li>
					))}
				</ul>
				<div className="p-3">
					<Button variant="primary" onClick={addSource}>
						<Icon icon="lucide:plus" width={16} height={16} aria-hidden="true" />
						Add Source
					</Button>
				</div>
			</div>
		</div>
	);
}
