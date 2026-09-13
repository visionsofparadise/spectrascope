const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function lastOpenedLabelOf(lastOpenedAt: string, now: number): string {
	const elapsedMs = Math.max(0, now - Date.parse(lastOpenedAt));

	if (!Number.isFinite(elapsedMs)) return "";

	if (elapsedMs < HOUR_MS) return relativeTimeFormat.format(-Math.floor(elapsedMs / MINUTE_MS), "minute");

	if (elapsedMs < DAY_MS) return relativeTimeFormat.format(-Math.floor(elapsedMs / HOUR_MS), "hour");

	if (elapsedMs < WEEK_MS) return relativeTimeFormat.format(-Math.floor(elapsedMs / DAY_MS), "day");

	if (elapsedMs < MONTH_MS) return relativeTimeFormat.format(-Math.floor(elapsedMs / WEEK_MS), "week");

	return relativeTimeFormat.format(-Math.floor(elapsedMs / MONTH_MS), "month");
}
