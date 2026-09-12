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
	original.viewSettings.frequencyScale = "erb";
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

it("loads older session settings as Mel and validates all supported frequency scales", () => {
	const session = JSON.parse(serializeSession(createComparison(["/a.wav"]), ["a.wav"]));
	delete session.comparison.viewSettings.frequencyScale;
	expect(parseSession(JSON.stringify(session)).viewSettings.frequencyScale).toBe("mel");
	for (const frequencyScale of ["linear", "log", "mel", "erb"]) {
		session.comparison.viewSettings.frequencyScale = frequencyScale;
		expect(parseSession(JSON.stringify(session)).viewSettings.frequencyScale).toBe(frequencyScale);
	}
	session.comparison.viewSettings.frequencyScale = "unknown";
	expect(() => parseSession(JSON.stringify(session))).toThrow("Invalid");
});

it.each([1, 2, 4, 8, "full"] as const)("persists spectrogram sampling %s in session files", (sampling) => {
	const original = createComparison(["/audio/a.wav"]);
	original.viewSettings.spectrogramSampling = sampling;
	const parsed = parseSession(serializeSession(original, ["a.wav"]));
	expect(parsed.viewSettings.spectrogramSampling).toBe(sampling);
});

it("defaults new and older sessions to 4× sampling and rejects unsupported modes", () => {
	const original = createComparison(["/audio/a.wav"]);
	expect(original.viewSettings.spectrogramSampling).toBe(4);
	const session = JSON.parse(serializeSession(original, ["a.wav"]));
	delete session.comparison.viewSettings.spectrogramSampling;
	expect(parseSession(JSON.stringify(session)).viewSettings.spectrogramSampling).toBe(4);
	for (const value of [0, 3, 16, "4", "unknown", null]) {
		session.comparison.viewSettings.spectrogramSampling = value;
		expect(() => parseSession(JSON.stringify(session))).toThrow("Invalid");
	}
});

it.each(["lava", "viridis"] as const)("persists the standard %s spectrogram colour map", (colormap) => {
	const original = createComparison(["/audio/a.wav"]);
	original.viewSettings.spectrogramColormap = colormap;
	const parsed = parseSession(serializeSession(original, ["a.wav"]));
	expect(parsed.viewSettings.spectrogramColormap).toBe(colormap);
});

it("defaults new and older sessions to Lava and rejects unsupported colour maps", () => {
	const original = createComparison(["/audio/a.wav"]);
	expect(original.viewSettings.spectrogramColormap).toBe("lava");
	const session = JSON.parse(serializeSession(original, ["a.wav"]));
	delete session.comparison.viewSettings.spectrogramColormap;
	expect(parseSession(JSON.stringify(session)).viewSettings.spectrogramColormap).toBe("lava");
	for (const value of ["inferno", "source", "Lava", 0, null, {}]) {
		session.comparison.viewSettings.spectrogramColormap = value;
		expect(() => parseSession(JSON.stringify(session))).toThrow("Invalid");
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
