import { frequencyToScalePosition, scalePositionToFrequency } from "spectral-display";
import { FULL_FREQUENCY_RANGE } from "./frequencyRange";
import type { FrequencyScale, TextureVerticalRange } from "spectral-display";

export function spectrogramPlacement(
	nativeSampleRate: number,
	displaySampleRate: number,
	range: TextureVerticalRange = FULL_FREQUENCY_RANGE,
	scale: FrequencyScale = "mel",
) {
	if (nativeSampleRate === displaySampleRate) return { top: 0, height: 1, range, visible: true };

	const nativeTop = 1 - frequencyToScalePosition(nativeSampleRate / 2, displaySampleRate, scale);
	const top = Math.max(range.top, nativeTop);

	if (top >= range.bottom) return { top: 0, height: 1, range: FULL_FREQUENCY_RANGE, visible: false };

	const nativeFraction = (fraction: number) =>
		Math.max(
			0,
			Math.min(
				1,
				1 -
					frequencyToScalePosition(
						scalePositionToFrequency(1 - fraction, displaySampleRate, scale),
						nativeSampleRate,
						scale,
					),
			),
		);

	return {
		top: (top - range.top) / (range.bottom - range.top),
		height: (range.bottom - top) / (range.bottom - range.top),
		range: { top: nativeFraction(top), bottom: nativeFraction(range.bottom) },
		visible: true,
	};
}
