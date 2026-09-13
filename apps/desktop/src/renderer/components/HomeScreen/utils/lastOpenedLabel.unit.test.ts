import { describe, expect, it } from "vitest";
import { lastOpenedLabelOf } from "./lastOpenedLabel";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-09-13T12:00:00.000Z");

function labelAfter(elapsedMs: number): string {
	return lastOpenedLabelOf(new Date(NOW - elapsedMs).toISOString(), NOW);
}

describe("last opened label", () => {
	it.each([
		[0, "this minute"],
		[MINUTE_MS - 1, "this minute"],
		[MINUTE_MS, "1 minute ago"],
		[HOUR_MS - 1, "59 minutes ago"],
		[HOUR_MS, "1 hour ago"],
		[DAY_MS - 1, "23 hours ago"],
		[DAY_MS, "yesterday"],
		[7 * DAY_MS - 1, "6 days ago"],
		[7 * DAY_MS, "last week"],
		[30 * DAY_MS - 1, "4 weeks ago"],
		[30 * DAY_MS, "last month"],
		[90 * DAY_MS, "3 months ago"],
	])("labels %i ms elapsed as %s", (elapsedMs, label) => {
		expect(labelAfter(elapsedMs)).toBe(label);
	});

	it("treats a future timestamp as just opened", () => {
		expect(labelAfter(-HOUR_MS)).toBe("this minute");
	});

	it("labels an unreadable timestamp as empty", () => {
		expect(lastOpenedLabelOf("not a date", NOW)).toBe("");
	});
});
