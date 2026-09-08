export function formatInspectionTime(timeMs: number, precision = 6): string {
	if (!Number.isFinite(timeMs) || timeMs < 0) return "—";

	const digits = Math.max(0, Math.min(6, precision));
	const units = 10 ** digits;
	const total = Math.round((timeMs / 1000) * units);
	const minutes = Math.floor(total / (60 * units));
	const seconds = ((total % (60 * units)) / units).toFixed(digits);

	return `${minutes.toString().padStart(2, "0")}:${seconds.padStart(digits > 0 ? 3 + digits : 2, "0")}`;
}
