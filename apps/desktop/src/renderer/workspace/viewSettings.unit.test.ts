import { describe, expect, it } from "vitest";
import { INITIAL_VIEW_CONTROL_SETTINGS, METRICS, ViewControlSettingsSchema } from "./viewSettings";

describe("ViewControlSettingsSchema", () => {
	it.each(["integrated", "truePeak", "samplePeak"])("migrates the stored %s metric to momentary", (loudnessMetric) => {
		expect(ViewControlSettingsSchema.parse({ loudnessMetric }).loudnessMetric).toBe("momentary");
	});

	it.each(METRICS.map((metric) => metric.id))("keeps the %s metric", (loudnessMetric) => {
		expect(ViewControlSettingsSchema.parse({ loudnessMetric }).loudnessMetric).toBe(loudnessMetric);
	});

	it("defaults to momentary loudness and a square root vectorscope", () => {
		const settings = ViewControlSettingsSchema.parse({});
		expect(settings.loudnessMetric).toBe("momentary");
		expect(settings.vectorscopeScale).toBe("sqrt");
		expect(INITIAL_VIEW_CONTROL_SETTINGS).toMatchObject({ loudnessMetric: "momentary", vectorscopeScale: "sqrt" });
	});

	it("rejects unknown metrics and scales", () => {
		expect(ViewControlSettingsSchema.safeParse({ loudnessMetric: "peak" }).success).toBe(false);
		expect(ViewControlSettingsSchema.safeParse({ vectorscopeScale: "cube" }).success).toBe(false);
	});
});
