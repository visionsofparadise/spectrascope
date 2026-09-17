import { expect, it } from "vitest";
import { createSavedSession } from "../createSavedSession";
import { sessionFingerprint, isSessionDirty } from "./sessionFingerprint";

it("ignores playback position and runtime metadata but tracks persisted editing controls", () => {
	const comparison = createSavedSession([]);
	expect(isSessionDirty(comparison)).toBe(false);
	comparison.positionSec = 8;
	comparison.sessionFilePath = "/session.spectra";
	expect(isSessionDirty(comparison)).toBe(false);
	const fingerprint = sessionFingerprint(comparison);
	comparison.name = "Changed";
	expect(isSessionDirty(comparison)).toBe(true);
	comparison.savedFingerprint = sessionFingerprint(comparison);
	expect(isSessionDirty(comparison)).toBe(false);
	comparison.volume = 0.5;
	expect(sessionFingerprint(comparison)).not.toBe(fingerprint);
	expect(isSessionDirty(comparison)).toBe(true);
});
