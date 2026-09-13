import { describe, expect, it } from "vitest";
import { formatInspectionTime } from "./formatInspectionTime";

describe("inspection time precision", () => {
	it("reads out milliseconds by default", () => {
		expect(formatInspectionTime(83456.7891)).toBe("01:23.457");
	});
	it("keeps finer precision available to callers that request it", () => {
		expect(formatInspectionTime(0.005, 6)).toBe("00:00.000005");
	});
	it("carries rounding into the next minute", () => {
		expect(formatInspectionTime(59999.9999, 3)).toBe("01:00.000");
	});
	it("formats missing and very short coordinates accurately", () => {
		expect(formatInspectionTime(NaN)).toBe("—");
		expect(formatInspectionTime(0.005)).toBe("00:00.000");
	});
});
