import { expect, it } from "vitest";
import { createComparison } from "../createComparison";
import { parseSession, serializeSession } from "./sessionDocument";
import { ViewControlSettingsSchema } from "../../workspace/viewSettings";

it("roundtrips settings and references while regenerating only the comparison identity", () => {
	const original = createComparison(["/audio/a.wav", "/audio/b.wav"]);
	original.name = "A/B";
	original.differenceA = original.sources[0]?.id ?? null;
	original.differenceB = original.sources[1]?.id ?? null;
	original.viewSettings.frequencyRange = { top: 0.25, bottom: 0.5 };
	original.volume = 0.4;
	original.looping = true;
	const parsed = parseSession(serializeSession(original, ["../audio/a.wav", "../audio/b.wav"]));
	expect(parsed.id).not.toBe(original.id);
	expect(parsed.sources.map((source) => source.id)).toEqual(original.sources.map((source) => source.id));
	expect(parsed.name).toBe("A/B");
	expect(parsed.viewSettings).toEqual(original.viewSettings);
	expect(parsed.volume).toBe(0.4);
	expect(parsed.looping).toBe(true);
	expect(parsed.differenceB).toBe(original.differenceB);
});

it("roundtrips frequency navigation at its minimum span across floating-point boundaries", () => {
	for (let index = 0; index < 1000; index++) {
		const top = index / 1024;
		expect(ViewControlSettingsSchema.safeParse({ frequencyRange: { top, bottom: top + 1 / 64 } }).success).toBe(true);
	}
});

it("rejects unsupported versions, invalid settings and broken source identities", () => {
	const session = JSON.parse(serializeSession(createComparison(["/a.wav"]), ["a.wav"])) as {
		version: number;
		comparison: Record<string, unknown>;
	};
	session.version = 2;
	expect(() => parseSession(JSON.stringify(session))).toThrow("unsupported");
	session.version = 1;
	session.comparison.differenceA = "missing";
	expect(() => parseSession(JSON.stringify(session))).toThrow("source");
	session.comparison.differenceA = null;
	session.comparison.viewSettings = { frequencyRange: { top: 0.5, bottom: 0.5001 } };
	expect(() => parseSession(JSON.stringify(session))).toThrow("Invalid");
	expect(() => parseSession("broken")).toThrow("JSON");
});
