import { z } from "zod";
import { THEME_IDS } from "../../utils/themePalettes";
import { ViewControlSettingsSchema } from "../../workspace/viewSettings";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { State } from ".";
import type { ProxyStore } from "../ProxyStore/ProxyStore";
import type { Snapshot } from "valtio/vanilla";

const TabEntrySchema = z.object({
	id: z.string(),
	comparisonId: z.string(),
});

const WindowBoundsSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
});

const LayerColorSchema = z.object({
	primary: z.string(),
	secondary: z.string(),
});

const SourceSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	audioFilePath: z.string(),
	timelineOffsetMs: z.number().nonnegative(),
	layerColor: LayerColorSchema,
	visible: z.boolean(),
	muted: z.boolean(),
	soloed: z.boolean(),
});

const ViewIdSchema = z.enum([
	"timeline",
	"overlay",
	"slider",
	"difference",
	"sum",
	"frequency-distribution",
	"loudness",
	"correlation",
	"vectorscope",
]);

const ChannelInputSchema = z.enum(["mono", "mid", "side"]);

const SelectionSchema = z
	.object({
		start: z.number(),
		end: z.number(),
	})
	.nullable();

const PreferencesSchema = z.object({
	sampleRate: z.number().int().min(8000).max(384000).nullable().default(null),
	monitorVolume: z.number().min(0).max(1).default(1),
	playbackRate: z.number().min(0.25).max(2).default(1),
	fftSize: ViewControlSettingsSchema.shape.fftSize,
	hopOverlap: ViewControlSettingsSchema.shape.hopOverlap,
});

export type Preferences = z.infer<typeof PreferencesSchema>;
export const INITIAL_PREFERENCES: Preferences = PreferencesSchema.parse({});

export const SavedSessionSchema = z.object({
	id: z.string(),
	name: z.string().trim().min(1).max(200).default("New Session"),
	viewSettings: ViewControlSettingsSchema.prefault({}),
	volume: z.number().min(0).max(1).default(1),
	playbackRate: z.number().min(0.25).max(2).default(1),
	looping: z.boolean().default(false),
	sessionFilePath: z.string().nullable().default(null),
	savedFingerprint: z.string().nullable().default(null),
	sources: z.array(SourceSchema).default([]),
	activeView: ViewIdSchema.default("overlay"),
	channelInput: ChannelInputSchema.default("mono"),
	positionSec: z.number().default(0),
	selection: SelectionSchema.default(null),
	/**
	 * The comparison's canonical sample rate — every source is streamed at this
	 * rate. `null` until the first imported source captures its native rate;
	 * sticky thereafter and user-settable from the sidebar Rate dropdown.
	 */
	canonicalSampleRate: z.number().int().positive().max(768000).nullable().default(null),
	differenceA: z.string().nullable().default(null),
	differenceB: z.string().nullable().default(null),
});

const AppStateSchema = z.object({
	preferences: PreferencesSchema.prefault({}),
	recentSessions: z
		.array(z.object({ filePath: z.string(), name: z.string(), lastOpenedAt: z.iso.datetime() }))
		.max(10)
		.default([]),
	tabs: z.array(TabEntrySchema).default([]),
	activeTabId: z.string().nullable().default(null),
	theme: z.enum(THEME_IDS).default("lava"),
	windowBounds: WindowBoundsSchema.optional(),
	comparisons: z.array(SavedSessionSchema).default([]),
});

export type WindowBounds = z.infer<typeof WindowBoundsSchema>;
export type SourceState = z.infer<typeof SourceSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;
export type AppState = z.infer<typeof AppStateSchema> & State;

const SavedStateSchema = AppStateSchema.pick({
	tabs: true,
	activeTabId: true,
	theme: true,
	windowBounds: true,
	comparisons: true,
	preferences: true,
	recentSessions: true,
}).partial();

export async function loadAppState(main: {
	getUserDataPath: () => Promise<string>;
	readFile: (path: string) => Promise<string>;
}): Promise<Omit<AppState, "_key">> {
	const userDataPath = await main.getUserDataPath();
	const path = `${userDataPath}/state.json`;

	let saved: z.infer<typeof SavedStateSchema> = {};

	try {
		const content = await main.readFile(path);
		const raw: unknown = JSON.parse(content);

		if (typeof raw === "object" && raw !== null && "comparisons" in raw && Array.isArray(raw.comparisons)) {
			for (const comparison of raw.comparisons as Array<unknown>) {
				if (typeof comparison !== "object" || comparison === null) continue;

				if (!("name" in comparison)) {
					const legacy = z
						.object({ sources: z.array(z.object({ name: z.string() })).optional() })
						.safeParse(comparison);

					(comparison as Record<string, unknown>).name = legacy.success
						? (legacy.data.sources?.[0]?.name ?? "New Session")
						: "New Session";
				}

				if ("savedFingerprint" in comparison && typeof comparison.savedFingerprint === "string") {
					(comparison as Record<string, unknown>).savedFingerprint = comparison.savedFingerprint.replace(
						/,"syncEnabled":(?:true|false)\}$/,
						"}",
					);
				}
			}
		}

		const result = SavedStateSchema.safeParse(raw);

		if (result.success) {
			saved = result.data;
		}
	} catch {
		saved = {};
	}

	const comparisons = saved.comparisons ?? [];

	const comparisonIds = new Set(comparisons.map((comparison) => comparison.id));
	const tabs = (saved.tabs ?? []).filter((tab) => comparisonIds.has(tab.comparisonId));

	const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
		? (saved.activeTabId ?? null)
		: (tabs[0]?.id ?? null);

	return {
		tabs,
		activeTabId,
		theme: saved.theme ?? "lava",
		windowBounds: saved.windowBounds,
		comparisons,
		preferences: saved.preferences ?? PreferencesSchema.parse({}),
		recentSessions: saved.recentSessions ?? [],
	};
}

export function useAppState(initial: Omit<AppState, "_key">, store: ProxyStore): Snapshot<AppState> {
	return useCreateState<AppState>(initial, store);
}
