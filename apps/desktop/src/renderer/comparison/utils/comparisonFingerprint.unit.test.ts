import { expect, it } from "vitest";
import { createComparison } from "../createComparison";
import { comparisonFingerprint, isComparisonDirty } from "./comparisonFingerprint";

it("ignores playback position and runtime metadata but tracks persisted editing controls", () => {
	const comparison = createComparison([]);
	expect(isComparisonDirty(comparison)).toBe(false);
	comparison.positionSec = 8;
	comparison.sessionFilePath = "/session.spectra";
	expect(isComparisonDirty(comparison)).toBe(false);
	const fingerprint = comparisonFingerprint(comparison);
	comparison.name = "Changed";
	expect(isComparisonDirty(comparison)).toBe(true);
	comparison.savedFingerprint = comparisonFingerprint(comparison);
	expect(isComparisonDirty(comparison)).toBe(false);
	comparison.volume = 0.5;
	expect(comparisonFingerprint(comparison)).not.toBe(fingerprint);
	expect(isComparisonDirty(comparison)).toBe(true);
});
