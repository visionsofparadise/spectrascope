import { z } from "zod";
import { SavedSessionSchema, type SavedSession } from "../../models/State/App";
import { createTabId } from "../createSavedSession";
import { sessionContent, sessionFingerprint } from "./sessionFingerprint";

const SessionFileContentSchema = SavedSessionSchema.omit({
	id: true,
	sessionFilePath: true,
	savedFingerprint: true,
}).superRefine((session, context) => {
	const ids = new Set(session.sources.map((source) => source.id));

	if (ids.size !== session.sources.length)
		context.addIssue({ code: "custom", message: "Duplicate source identities" });

	for (const id of [session.differenceA, session.differenceB]) {
		if (id !== null && !ids.has(id)) context.addIssue({ code: "custom", message: "Unknown difference source" });
	}

	if (session.selection && (session.selection.start < 0 || session.selection.end < session.selection.start)) {
		context.addIssue({ code: "custom", message: "Invalid selection" });
	}

	if (session.sources.some((source) => source.timelineOffsetMs < 0))
		context.addIssue({ code: "custom", message: "Invalid source offset" });
});

const SessionFileSchema = z.object({
	format: z.literal("spectrascope"),
	version: z.literal(1),
	savedAt: z.iso.datetime(),
	comparison: SessionFileContentSchema,
});

export function serializeSession(session: SavedSession, paths: ReadonlyArray<string>): string {
	if (paths.length !== session.sources.length) throw new Error("Source path count does not match session");

	const content = {
		...sessionContent(session),
		positionSec: session.positionSec,
		sources: session.sources.map((source, index) => ({ ...source, audioFilePath: paths[index] })),
	};

	return JSON.stringify(
		SessionFileSchema.parse({
			format: "spectrascope",
			version: 1,
			savedAt: new Date().toISOString(),
			comparison: content,
		}),
		null,
		2,
	);
}

export function parseSession(content: string): SavedSession {
	let raw: unknown;

	try {
		raw = JSON.parse(content);
	} catch {
		throw new Error("This file is not valid session JSON");
	}

	const parsed = SessionFileSchema.safeParse(raw);

	if (!parsed.success)
		throw new Error(
			"Invalid or unsupported Spectrascope session: " + (parsed.error.issues[0]?.message ?? "Invalid data"),
		);

	return { ...parsed.data.comparison, id: createTabId(), sessionFilePath: null, savedFingerprint: null };
}

export function markSessionSaved(session: SavedSession, filePath: string): SavedSession {
	return { ...session, sessionFilePath: filePath, savedFingerprint: sessionFingerprint(session) };
}
