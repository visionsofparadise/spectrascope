import { useMemo } from "react";
import { VectorscopeCanvas } from "spectral-display";
import { hexToRgb255 } from "../spectral/colorUtil";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { useTraceCompute } from "../spectral/traceCompute";
import { useDisabledTransport } from "../spectral/viewScaffold";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { SpectralOptions } from "spectral-display";

const VECTORSCOPE_CONFIG: SpectralOptions["config"] = {
	spectrogram: false,
	loudness: false,
	truePeak: false,
	stereo: true,
};

interface VectorscopeViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

function FullBleedAxes() {
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 1 1"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<line
				x1={0.5}
				y1={0}
				x2={0.5}
				y2={1}
				stroke="var(--color-chrome-border)"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
			<line
				x1={0}
				y1={0.5}
				x2={1}
				y2={0.5}
				stroke="var(--color-chrome-border)"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

function ScopeDiagonals() {
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 1 1"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<line
				x1={0}
				y1={0}
				x2={1}
				y2={1}
				stroke="var(--color-chrome-text-dim)"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
			<line
				x1={1}
				y1={0}
				x2={0}
				y2={1}
				stroke="var(--color-chrome-text-dim)"
				strokeWidth={1}
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

interface SourceCloudProps {
	readonly source: Source;
	readonly audioData: AudioData;
	readonly onComputeState?: (sourceId: string, state: ComputeState | null) => void;
}

function SourceCloud({ source, audioData, onComputeState }: SourceCloudProps) {
	const { computeResult, renderable } = useTraceCompute(audioData, 0, audioData.durationMs, VECTORSCOPE_CONFIG);

	useReportComputeState(source.id, computeResult, onComputeState);

	const tint = useMemo(() => hexToRgb255(source.layerColor.primary), [source.layerColor.primary]);

	return (
		<div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
			<VectorscopeCanvas computeResult={renderable ?? computeResult} tint={tint} />
		</div>
	);
}

export function VectorscopeView({ sources, sourceAudio, onTransportControlChange }: VectorscopeViewProps) {
	const renderableSources = useMemo(() => resolveVisibleSourceAudio(sources, sourceAudio), [sources, sourceAudio]);

	const progress = useFirstComputeProgress();

	useDisabledTransport(onTransportControlChange);

	return (
		<div className="flex h-full min-h-0 w-full flex-col bg-void p-4">
			{renderableSources.length === 0 ? (
				<div className="flex h-full items-center justify-center bg-void">
					<p className="font-body text-sm text-chrome-text-secondary">No visible sources.</p>
				</div>
			) : (
				<div className="relative flex min-h-0 flex-1 items-center justify-center" style={{ containerType: "size" }}>
					<FullBleedAxes />
					<div
						className="relative aspect-square overflow-hidden"
						style={{ width: "100cqmin", height: "100cqmin" }}
					>
						<div className="absolute inset-0" style={{ mixBlendMode: "lighten" }}>
							{renderableSources.map(({ source, audioData }) => (
								<SourceCloud
									key={source.id}
									source={source}
									audioData={audioData}
									onComputeState={progress.handleComputeState}
								/>
							))}
						</div>
						<ScopeDiagonals />
					</div>
					{progress.firstComputing && <ComputeProgress fraction={progress.fraction} />}
				</div>
			)}
		</div>
	);
}
