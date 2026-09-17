import { flush } from "opshot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../models/State/Session";
import { createSavedSession, createSourceFromFile } from "../session/createSavedSession";
import { createDefaultSource } from "../workspace/source";
import { useSourceStreams } from "./useSourceStreams";
import type { StreamQueryEntry } from "./utils/streamQueryOptions";

interface QueryEntry {
	readonly queryKey: Array<string | number | null>;
}

const hooks = vi.hoisted(() => {
	const slots = new Array<{ deps: ReadonlyArray<unknown>; value: unknown }>();
	const cursor = { index: 0 };
	const memoize = (compute: () => unknown, deps: ReadonlyArray<unknown>) => {
		const index = cursor.index++;
		const previous = slots[index];

		if (previous?.deps.length === deps.length && previous.deps.every((dep, at) => Object.is(dep, deps[at]))) {
			return previous.value;
		}

		const value = compute();

		slots[index] = { deps, value };

		return value;
	};

	return { cursor, slots, memoize };
});
const queries = vi.hoisted(() => {
	const resetQueries = vi.fn();

	return {
		options: vi.fn((path: string, rate: number | null) => ({ queryKey: ["source-stream", path, rate] })),
		resetQueries,
		results: new Map<string, { data?: StreamQueryEntry; error?: Error }>(),
		sets: new Array<ReadonlyArray<{ queryKey: Array<string | number | null> }>>(),
		combined: { key: "", value: undefined as unknown },
		client: { resetQueries },
	};
});

vi.mock("react", () => ({
	useMemo: (compute: () => unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(compute, deps),
	useCallback: (callback: unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(() => callback, deps),
}));
vi.mock("./utils/streamQueryOptions", () => ({
	initializeStreamQueries: vi.fn(),
	sourceStreamQueryOptions: queries.options,
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => queries.client,
	useQueries: ({
		queries: entries,
		combine,
	}: {
		queries: Array<QueryEntry>;
		combine: (results: Array<{ data?: StreamQueryEntry; error?: Error }>) => unknown;
	}) => {
		queries.sets.push(entries);

		const key = JSON.stringify(entries.map((entry) => entry.queryKey));

		if (queries.combined.key === key) return queries.combined.value;

		queries.combined = {
			key,
			value: combine(entries.map((entry) => queries.results.get(String(entry.queryKey[1])) ?? {})),
		};

		return queries.combined.value;
	},
}));

function entry(sampleRate: number): StreamQueryEntry {
	return {
		info: { key: String(sampleRate), sampleRate, channelCount: 2, totalFrames: sampleRate, durationMs: 1000 },
		prepared: {
			pcmPath: `/pcm/${sampleRate}.wav`,
			sampleRate,
			channelCount: 2,
			sampleCount: sampleRate,
			nativeSampleRate: sampleRate,
			durationMs: 1000,
		},
		audioData: {
			sampleRate,
			channels: 2,
			totalSamples: sampleRate,
			durationMs: 1000,
			readSamples: () => Promise.resolve(new Float32Array(0)),
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	queries.results.clear();
	queries.sets.length = 0;
	queries.combined = { key: "", value: undefined };
	hooks.slots.length = 0;
	hooks.cursor.index = 0;
});

describe("native source preparation", () => {
	it("prepares each file once at native rate and retains mixed source metadata", () => {
		const low = createDefaultSource(0, { id: "low", audioFilePath: "/low.wav" });
		const high = createDefaultSource(1, { id: "high", audioFilePath: "/high.wav" });
		const duplicate = { ...low, id: "duplicate" };
		const lowEntry = entry(44100);
		const highEntry = entry(96000);
		queries.results.set(low.audioFilePath, { data: lowEntry });
		queries.results.set(high.audioFilePath, { data: highEntry });
		const result = useSourceStreams([low, high, duplicate]);

		expect(queries.options.mock.calls).toEqual([
			["/low.wav", null],
			["/high.wav", null],
		]);
		expect(result.sourceAudio.get("low")).toBe(lowEntry.audioData);
		expect(result.sourceAudio.get("high")?.sampleRate).toBe(96000);
		expect(result.sourceAudio.get("duplicate")).toBe(lowEntry.audioData);
		expect(result.prepared.get("low")?.sampleRate).toBe(44100);
		expect([...result.status.values()]).toEqual(["ready", "ready", "ready"]);
	});

	it("retries the failed native query and preserves missing/pending/error source states", () => {
		const failed = createDefaultSource(0, { id: "failed", audioFilePath: "/failed.wav" });
		const pending = createDefaultSource(1, { id: "pending", audioFilePath: "/pending.wav" });
		const missing = createDefaultSource(2, { id: "missing", audioFilePath: "" });
		queries.results.set(failed.audioFilePath, { error: new Error("Unreadable audio") });
		const result = useSourceStreams([failed, pending, missing]);

		expect([...result.status.entries()]).toEqual([
			["failed", "error"],
			["pending", "preparing"],
			["missing", "error"],
		]);
		expect(result.errors.get("failed")).toBe("Unreadable audio");
		result.retrySource("failed");
		expect(queries.resetQueries).toHaveBeenCalledExactlyOnceWith({
			queryKey: ["source-stream", "/failed.wav", null],
			exact: true,
		});
		result.retrySource("missing");
		result.retrySource("gone");
		expect(queries.resetQueries).toHaveBeenCalledTimes(1);
	});
});

describe("query set stability", () => {
	function render(sources: ReturnType<typeof createSession>["document"]["sources"]) {
		hooks.cursor.index = 0;

		const result = useSourceStreams(sources);

		return { result, querySet: queries.sets[queries.sets.length - 1] as ReadonlyArray<QueryEntry> };
	}

	function pathsOf(querySet: ReadonlyArray<QueryEntry>): Array<string | number | null | undefined> {
		return querySet.map((entry) => entry.queryKey[1]);
	}

	it("follows a source add, a source removal and a relink", () => {
		const { document } = createSession(createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]));
		const initial = render(document.sources);

		expect(pathsOf(initial.querySet)).toEqual(["C:/audio/a.wav", "C:/audio/b.wav"]);

		document.sources.push(createSourceFromFile("C:/audio/c.wav", 2));
		flush(document);

		const added = render(document.sources);

		expect(added.querySet).not.toBe(initial.querySet);
		expect(pathsOf(added.querySet)).toEqual(["C:/audio/a.wav", "C:/audio/b.wav", "C:/audio/c.wav"]);

		document.sources.splice(1, 1);
		flush(document);

		expect(pathsOf(render(document.sources).querySet)).toEqual(["C:/audio/a.wav", "C:/audio/c.wav"]);

		document.sources[0]!.audioFilePath = "C:/audio/relinked.wav";
		flush(document);

		expect(pathsOf(render(document.sources).querySet)).toEqual(["C:/audio/relinked.wav", "C:/audio/c.wav"]);
	});

	it("keeps the query set and the stream maps across a mute toggle", () => {
		const { document } = createSession(createSavedSession(["C:/audio/a.wav"]));
		const before = render(document.sources);

		document.sources[0]!.muted = true;
		flush(document);

		const after = render(document.sources);

		expect(after.querySet).toBe(before.querySet);
		expect(after.result).toBe(before.result);
		expect(after.result.sourceAudio).toBe(before.result.sourceAudio);
	});
});
