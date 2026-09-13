import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSource } from "../workspace/source";
import { useSourceStreams } from "./useSourceStreams";
import type { StreamQueryEntry } from "./utils/streamQueryOptions";

const queries = vi.hoisted(() => ({
	options: vi.fn((path: string, rate: number | null) => ({ queryKey: ["source-stream", path, rate] })),
	resetQueries: vi.fn(),
	results: new Map<string, { data?: StreamQueryEntry; error?: Error }>(),
}));

vi.mock("react", () => ({
	useMemo: (compute: () => unknown) => compute(),
	useCallback: (callback: unknown) => callback,
}));
vi.mock("./utils/streamQueryOptions", () => ({
	initializeStreamQueries: vi.fn(),
	sourceStreamQueryOptions: queries.options,
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ resetQueries: queries.resetQueries }),
	useQueries: ({
		queries: entries,
		combine,
	}: {
		queries: Array<{ queryKey: Array<string | number | null> }>;
		combine: (results: Array<{ data?: StreamQueryEntry; error?: Error }>) => unknown;
	}) => combine(entries.map((entry) => queries.results.get(String(entry.queryKey[1])) ?? {})),
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
