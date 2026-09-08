import { describe, expect, it } from "vitest";
import { formatInspectionTime } from "./formatInspectionTime";

describe("inspection time precision", () => {
	it.each([44100, 48000, 192000])("distinguishes consecutive samples at %i Hz", (rate) => {
		expect(formatInspectionTime(3600000)).not.toBe(formatInspectionTime(3600000 + 1000 / rate));
	});
	it("carries rounding into the next minute", () => {
		expect(formatInspectionTime(59999.9999, 3)).toBe("01:00.000");
	});
	it("formats missing and very short coordinates accurately", () => {
		expect(formatInspectionTime(NaN)).toBe("—");
		expect(formatInspectionTime(0.005)).toBe("00:00.000005");
	});
});
