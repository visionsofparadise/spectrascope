import { Icon } from "@iconify/react";
import type { Source } from "./source";
import { createDefaultSource } from "./source";
import type { SourceStreamStatus } from "../audio/useSourceStreams";
import { Button } from "../components/Button";
import { SourceRow } from "./SourceRow";

interface SourcesPanelProps {
	readonly sources: ReadonlyArray<Source>;
	readonly onChange: (next: ReadonlyArray<Source>) => void;
	/** Per-source preparation status keyed by `Source.id` — drives each row's progress/error treatment. */
	readonly sourceStatus?: ReadonlyMap<string, SourceStreamStatus>;
	readonly activeSourceId?: string;
	readonly onActiveSourceChange?: (id: string) => void;
}

/**
 * The left sidebar of the workspace shell. Header label, vertical list of
 * `SourceRow`s with a trailing `+ Add source` row that follows the list's
 * vertical rhythm (no detached footer button — the add affordance belongs at
 * the end of the list it adds to, not pinned to the panel chrome).
 *
 * Controlled — owns no source state. `onChange` is the canonical mutation
 * channel for adds, removes, and per-row property edits.
 */
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
			{/* Header — letter-spaced technical caps for the section label. Fixed
			    `h-10` for vertical rhythm across the divider-free shell; no border
			    — the panel shares the void surface seamlessly with the workspace. */}
			<div className="flex h-10 shrink-0 items-center px-4">
				<span className="font-technical text-xs uppercase tracking-[0.08em] text-chrome-text-secondary">
					Sources
				</span>
			</div>

			{/* Body — list of source rows with the Add Source button directly
			    below the last row (in the list flow, not pinned to the panel
			    bottom). Scrolls together when overflowing. */}
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
								onActivate={
									onActiveSourceChange
										? () => onActiveSourceChange(source.id)
										: undefined
								}
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
