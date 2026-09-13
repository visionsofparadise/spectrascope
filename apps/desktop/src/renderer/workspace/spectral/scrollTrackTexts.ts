import type { AxisRange } from "../utils/axisRange";

export function scrollTrackTextsOf(
	axis: "x" | "y",
	label: string,
	range: AxisRange,
	formatValueAt: (fraction: number) => string,
	unit = "",
) {
	const suffix = unit ? ` ${unit}` : "";
	const startText = formatValueAt(range.start);
	const endText = formatValueAt(range.end);
	const lowerLabel = label.toLowerCase();

	return {
		label,
		valueText: axis === "y" ? `${endText} to ${startText}${suffix}` : `${startText} to ${endText}${suffix}`,
		edgeLabels:
			axis === "y"
				? ([`Upper ${lowerLabel}`, `Lower ${lowerLabel}`] as const)
				: ([`Start ${lowerLabel}`, `End ${lowerLabel}`] as const),
		edgeValueTexts: [`${startText}${suffix}`, `${endText}${suffix}`] as const,
	};
}

export function trackValueTextOf(value: number): string {
	return String(Number(value.toFixed(2)) + 0);
}
