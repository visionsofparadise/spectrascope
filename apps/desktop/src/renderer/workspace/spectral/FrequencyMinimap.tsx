import { constrainFrequencyRange, MIN_FREQUENCY_SPAN } from "../utils/frequencyRange";
import { fractionToFrequency } from "../utils/frequencyScale";
import { ScrollTrack } from "./ScrollTrack";
import { scrollTrackTextsOf } from "./scrollTrackTexts";
import type { AxisRange } from "../utils/axisRange";
import type { FrequencyScale, TextureVerticalRange } from "spectral-display";

interface FrequencyMinimapProps {
	readonly amplitude?: boolean;
	readonly sampleRate: number;
	readonly frequencyScale?: FrequencyScale;
	readonly frequencyRange: TextureVerticalRange;
	readonly onFrequencyRangeChange: (range: TextureVerticalRange) => void;
}

export function FrequencyMinimap({
	amplitude = false,
	sampleRate,
	frequencyScale = "mel",
	frequencyRange,
	onFrequencyRangeChange,
}: FrequencyMinimapProps) {
	const constrained = constrainFrequencyRange(frequencyRange);
	const range: AxisRange = { start: constrained.top, end: constrained.bottom };
	const texts = amplitude
		? scrollTrackTextsOf(
				"y",
				"Amplitude range",
				range,
				(fraction) => String(Number((1 - 2 * fraction).toFixed(3))),
				"FS",
			)
		: scrollTrackTextsOf(
				"y",
				"Frequency range",
				range,
				(fraction) => String(Math.round(fractionToFrequency(fraction, sampleRate, undefined, frequencyScale))),
				"Hz",
			);
	const subject = amplitude ? "amplitude" : "frequency";

	return (
		<ScrollTrack
			axis="y"
			range={range}
			minSpan={MIN_FREQUENCY_SPAN}
			{...texts}
			edgeLabels={[`Upper ${subject} limit`, `Lower ${subject} limit`]}
			onRangeChange={(next) => onFrequencyRangeChange({ top: next.start, bottom: next.end })}
		/>
	);
}
