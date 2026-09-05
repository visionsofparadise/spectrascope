import { useCallback, useMemo } from "react";
import { Select } from "../../components/Select";
import { NEUTRAL_LAYER_COLOR } from "../layers";
import { StripLayout, StripOverlays, StripSourceRender, useStripView } from "../spectral/stripView";
import type { Source } from "../source";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { ViewControlSettings } from "../viewSettings";
import type { ChannelInput } from "spectral-display";

interface DifferenceViewProps {
	readonly sources: ReadonlyArray<Source>;
	/**
	 * The A−B difference signal as a single PCM reader, backed by the registered
	 * diff stream (`EMPTY_DERIVED_AUDIO` until A and B both resolve).
	 */
	readonly derivedAudio: AudioData;
	readonly channelInput: ChannelInput;
	readonly settings: ViewControlSettings;
	/**
	 * The A/B source selection (source ids), or `null` until the sticky default
	 * is written. `A − B`: A is the reference, B is polarity-inverted. A `null`
	 * or dangling (removed-source) field falls back to the default first-two in
	 * the selector display.
	 */
	readonly differenceA: string | null;
	readonly differenceB: string | null;
	readonly onDifferenceChange: (differenceA: string, differenceB: string) => void;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

export function DifferenceView({
	sources,
	derivedAudio,
	channelInput,
	settings,
	differenceA,
	differenceB,
	onDifferenceChange,
	onTransportControlChange,
}: DifferenceViewProps) {
	const visibleSources = useMemo(() => sources.filter((source) => source.visible), [sources]);

	const layerColor = visibleSources[0]?.layerColor ?? NEUTRAL_LAYER_COLOR;

	const view = useStripView("difference", derivedAudio, layerColor, onTransportControlChange);

	const differenceSource = useMemo<Source>(
		() => ({
			id: "difference",
			name: "Difference",
			audioFilePath: "derived",
			timelineOffsetMs: 0,
			layerColor,
			visible: true,
			muted: false,
			soloed: false,
		}),
		[layerColor],
	);

	const sourceOptions = useMemo(() => sources.map((source) => ({ value: source.id, label: source.name })), [sources]);

	const sourceIds = useMemo(() => new Set(sources.map((source) => source.id)), [sources]);
	const selectedA = differenceA !== null && sourceIds.has(differenceA) ? differenceA : (sources[0]?.id ?? "");
	const selectedB = differenceB !== null && sourceIds.has(differenceB) ? differenceB : (sources[1]?.id ?? "");

	const handleSelectA = useCallback(
		(next: string) => {
			onDifferenceChange(next, selectedB);
		},
		[onDifferenceChange, selectedB],
	);

	const handleSelectB = useCallback(
		(next: string) => {
			onDifferenceChange(selectedA, next);
		},
		[onDifferenceChange, selectedA],
	);

	const selectorRow = (
		<div className="flex shrink-0 items-center gap-4 border-b border-chrome-border-subtle bg-void px-3 py-1.5">
			<div className="flex items-center gap-1.5">
				<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-secondary">
					A
				</span>
				<Select variant="chip" value={selectedA} options={sourceOptions} onChange={handleSelectA} />
			</div>
			<span aria-hidden className="font-technical text-[length:var(--text-sm)] text-chrome-text-dim">
				−
			</span>
			<div className="flex items-center gap-1.5">
				<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.08em] text-chrome-text-secondary">
					B − inverted
				</span>
				<Select variant="chip" value={selectedB} options={sourceOptions} onChange={handleSelectB} />
			</div>
		</div>
	);

	return (
		<StripLayout view={view} header={selectorRow}>
			<div className="absolute inset-0">
				<StripSourceRender
					view={view}
					settings={settings}
					channelInput={channelInput}
					source={differenceSource}
					audioData={derivedAudio}
				/>
			</div>
			<StripOverlays view={view} settings={settings} />
		</StripLayout>
	);
}
