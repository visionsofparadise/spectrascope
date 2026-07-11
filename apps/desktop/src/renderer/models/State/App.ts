import type { Snapshot } from "valtio/vanilla";
import { z } from "zod";
import type { State } from ".";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";

/** Each tab is one comparison; it references its comparison by id. */
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

/** A layer's user-assignable color pair — mirrors `LayerColor` from the design-system. */
const LayerColorSchema = z.object({
	primary: z.string(),
	secondary: z.string(),
});

/**
 * Serializable mirror of the design-system `Source`. Carries no PCM and no
 * functions — only the persisted fields. `AudioData` is resolved at runtime
 * from `audioFilePath`.
 */
const SourceSchema = z.object({
	id: z.string(),
	name: z.string(),
	audioFilePath: z.string(),
	timelineOffsetMs: z.number(),
	layerColor: LayerColorSchema,
	visible: z.boolean(),
	muted: z.boolean(),
	soloed: z.boolean(),
});

/** The set of view tabs the workspace exposes — mirrors the design-system `ViewId`. */
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

/** The channel-collapse mode passed to `spectral-display` — mirrors its `ChannelInput`. */
const ChannelInputSchema = z.enum(["mono", "mid", "side"]);

/** A time-range selection in milliseconds, or `null` when nothing is selected. */
const SelectionSchema = z
	.object({
		start: z.number(),
		end: z.number(),
	})
	.nullable();

/**
 * A comparison — the contents of one tab. Sources placed on a shared timeline,
 * the active view, the channel input, and transport/selection state. Fully
 * serializable; the autosaved `state.json` carries it verbatim.
 */
const ComparisonSchema = z.object({
	id: z.string(),
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
	canonicalSampleRate: z.number().nullable().default(null),
	/** Source id of the Difference view's A input, or `null` (defaults to the first source). */
	differenceA: z.string().nullable().default(null),
	/** Source id of the Difference view's B input, or `null` (defaults to the second source). */
	differenceB: z.string().nullable().default(null),
});

export const AppStateSchema = z.object({
	tabs: z.array(TabEntrySchema).default([]),
	activeTabId: z.string().nullable().default(null),
	theme: z.enum(["lava", "viridis"]).default("lava"),
	windowBounds: WindowBoundsSchema.optional(),
	comparisons: z.array(ComparisonSchema).default([]),
});

export type TabEntry = z.infer<typeof TabEntrySchema>;
export type WindowBounds = z.infer<typeof WindowBoundsSchema>;
export type SourceState = z.infer<typeof SourceSchema>;
export type Comparison = z.infer<typeof ComparisonSchema>;
export type AppState = z.infer<typeof AppStateSchema> & State;

const SavedStateSchema = AppStateSchema.pick({
	tabs: true,
	activeTabId: true,
	theme: true,
	windowBounds: true,
	comparisons: true,
}).partial();

export async function loadAppState(main: { getUserDataPath: () => Promise<string>; readFile: (path: string) => Promise<string> }): Promise<Omit<AppState, "_key">> {
	const userDataPath = await main.getUserDataPath();
	const path = `${userDataPath}/state.json`;

	let saved: z.infer<typeof SavedStateSchema> = {};

	try {
		const content = await main.readFile(path);
		const result = SavedStateSchema.safeParse(JSON.parse(content));

		if (result.success) {
			saved = result.data;
		}
	} catch {
		// no saved state
	}

	const comparisons = saved.comparisons ?? [];

	// Reconcile each tab against the loaded comparisons — drop tabs whose
	// referenced comparison no longer exists so a dangling `comparisonId` can
	// never reach the renderer.
	const comparisonIds = new Set(comparisons.map((comparison) => comparison.id));
	const tabs = (saved.tabs ?? []).filter((tab) => comparisonIds.has(tab.comparisonId));

	const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId) ? (saved.activeTabId ?? null) : (tabs[0]?.id ?? null);

	return {
		tabs,
		activeTabId,
		theme: saved.theme ?? "lava",
		windowBounds: saved.windowBounds,
		comparisons,
	};
}

export function useAppState(initial: Omit<AppState, "_key">, store: ProxyStore): Snapshot<AppState> {
	return useCreateState<AppState>(initial, store);
}
