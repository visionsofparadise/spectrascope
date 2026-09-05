import { useEffect, useMemo } from "react";
import { useSpectralCompute, VectorscopeCanvas } from "spectral-display";
import { hexToRgb255 } from "../spectral/colorUtil";
import { ComputeProgress } from "../spectral/ComputeProgress";
import { useFirstComputeProgress, useReportComputeState } from "../spectral/firstComputeProgress";
import { resolveVisibleSourceAudio } from "./viewAudio";
import type { Source } from "../source";
import type { ComputeState } from "../spectral/firstComputeProgress";
import type { AudioData } from "../spectral/types";
import type { TransportControl } from "../Transport";
import type { SpectralOptions } from "spectral-display";


interface VectorscopeViewProps {
	readonly sources: ReadonlyArray<Source>;
	readonly sourceAudio: ReadonlyMap<string, AudioData>;
	readonly onTransportControlChange?: (control: TransportControl) => void;
}

const DISABLED_CONTROL: TransportControl = {
	disabled: true,
	playing: false,
	positionSec: 0,
	durationSec: 0,
	onPlayToggle: () => {},
	onSeek: () => {},
};

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
	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData.sampleRate,
				sampleCount: audioData.totalSamples,
				channelCount: audioData.channels,
			},
			query: { startMs: 0, endMs: audioData.durationMs, width: 64, height: 64 },
			readSamples: audioData.readSamples,
			config: {
				spectrogram: false,
				loudness: false,
				truePeak: false,
				stereo: true,
			},
		}),
		[audioData.sampleRate, audioData.totalSamples, audioData.channels, audioData.durationMs, audioData.readSamples],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	const renderable =
		computeResult.status === "ready"
			? computeResult
			: computeResult.status === "computing" || computeResult.status === "error"
				? computeResult.previous
				: null;

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

	useEffect(() => {
		if (onTransportControlChange) {
			onTransportControlChange(DISABLED_CONTROL);
		}
	}, [onTransportControlChange]);

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
