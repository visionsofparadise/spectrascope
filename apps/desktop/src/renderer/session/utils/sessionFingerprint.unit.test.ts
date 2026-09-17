import { expect, it } from "vitest";
import { createSavedSession } from "../createSavedSession";
import { sessionFingerprint, isSessionDirty } from "./sessionFingerprint";

it("ignores playback position and runtime metadata but tracks persisted editing controls", () => {
	const session = createSavedSession([]);
	expect(isSessionDirty(session)).toBe(false);
	session.positionSec = 8;
	session.sessionFilePath = "/session.spectra";
	expect(isSessionDirty(session)).toBe(false);
	const fingerprint = sessionFingerprint(session);
	session.name = "Changed";
	expect(isSessionDirty(session)).toBe(true);
	session.savedFingerprint = sessionFingerprint(session);
	expect(isSessionDirty(session)).toBe(false);
	session.volume = 0.5;
	expect(sessionFingerprint(session)).not.toBe(fingerprint);
	expect(isSessionDirty(session)).toBe(true);
});
