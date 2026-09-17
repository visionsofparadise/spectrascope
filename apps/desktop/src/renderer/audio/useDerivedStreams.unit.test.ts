import { flush } from "opshot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { automaticMeta } from "../models/History";
import { createSession } from "../models/State/Session";
import { createSavedSession } from "../session/createSavedSession";
import { setDifference } from "../session/utils/documentWrites";
import { useDerivedStreams } from "./useDerivedStreams";
import type { StreamSpec } from "../../main/audio/streamDsp";
import type { PreparedSource } from "../../main/SourceCacheManager";
import type { SessionContext } from "../models/Context";
import type { Session } from "../models/State/Session";
import type { SourceState } from "../models/State/App";

const hooks = vi.hoisted(() => {
	const slots = new Array<{ deps: ReadonlyArray<unknown>; value: unknown }>();
	const effects = new Map<number, { deps: ReadonlyArray<unknown>; cleanup?: () => void }>();
	const pending = new Array<() => void>();
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

	return { slots, effects, pending, cursor, memoize };
});
const queries = vi.hoisted(() => {
	const refetch = vi.fn();

	return {
		refetch,
		client: { invalidateQueries: vi.fn() },
		result: { data: undefined, isFetching: false, error: null, refetch },
		options: vi.fn((spec: StreamSpec | null) => ({ queryKey: ["derived-stream", spec] })),
	};
});

vi.mock("react", () => ({
	useMemo: (compute: () => unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(compute, deps),
	useCallback: (callback: unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(() => callback, deps),
	useRef: (initial: unknown) => hooks.memoize(() => ({ current: initial }), []),
	useEffect: (effect: () => (() => void) | undefined, deps: ReadonlyArray<unknown>) => {
		const index = hooks.cursor.index++;
		const previous = hooks.effects.get(index);

		if (
			previous &&
			previous.deps.length === deps.length &&
			previous.deps.every((dep, at) => Object.is(dep, deps[at]))
		)
			return;

		hooks.pending.push(() => {
			previous?.cleanup?.();
			hooks.effects.set(index, { deps, cleanup: effect() });
		});
	},
}));
vi.mock("@tanstack/react-query", () => ({
	keepPreviousData: "keep-previous-data",
	useQueryClient: () => queries.client,
	useQuery: () => queries.result,
}));
vi.mock("./utils/streamQueryOptions", () => ({
	initializeStreamQueries: vi.fn(),
	derivedStreamQueryOptions: queries.options,
	retainStreamQuery: vi.fn(() => null),
}));

function preparedOf(sources: ReadonlyArray<SourceState>): ReadonlyMap<string, PreparedSource> {
	return new Map(sources.map((source) => [source.id, { pcmPath: `/pcm/${source.id}.wav` } as PreparedSource]));
}

function render(
	session: Session,
	prepared: ReadonlyMap<string, PreparedSource>,
	onDefaultDifference: (a: string, b: string) => void,
) {
	const { document } = session;

	hooks.cursor.index = 0;

	const result = useDerivedStreams(
		document.sources,
		prepared,
		document.differenceA,
		document.differenceB,
		onDefaultDifference,
	);

	for (const effect of hooks.pending.splice(0)) effect();

	return result;
}

function specs(): { sum: StreamSpec | null; difference: StreamSpec | null } {
	const calls = queries.options.mock.calls;

	return { sum: calls[calls.length - 2]?.[0] ?? null, difference: calls[calls.length - 1]?.[0] ?? null };
}

beforeEach(() => {
	vi.clearAllMocks();
	hooks.slots.length = 0;
	hooks.effects.clear();
	hooks.pending.length = 0;
	hooks.cursor.index = 0;
});

describe("derived stream specs", () => {
	it("follows a difference pick and a timeline offset write", () => {
		const session = createSession(createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav", "C:/audio/c.wav"]));
		const { document } = session;
		const [first, second, third] = document.sources.map((source) => source.id);
		const prepared = preparedOf(document.sources);
		const context = { session } as unknown as SessionContext;

		render(session, prepared, () => {});

		expect(specs().sum?.inputs).toEqual([
			{ pcmPath: `/pcm/${first}.wav`, offsetMs: 0, gain: 1 },
			{ pcmPath: `/pcm/${second}.wav`, offsetMs: 0, gain: 1 },
		]);
		expect(specs().difference?.inputs.map((input) => input.gain)).toEqual([1, -1]);

		setDifference(third!, second!, undefined, context);
		flush(document);
		render(session, prepared, () => {});

		expect(specs().sum?.inputs.map((input) => input.pcmPath)).toEqual([`/pcm/${third}.wav`, `/pcm/${second}.wav`]);

		document.sources[2]!.timelineOffsetMs = 750;
		flush(document);
		render(session, prepared, () => {});

		expect(specs().sum?.inputs.map((input) => input.offsetMs)).toEqual([750, 0]);
		expect(specs().difference?.inputs.map((input) => input.offsetMs)).toEqual([750, 0]);
	});

	it("keeps the specs across a mute toggle", () => {
		const session = createSession(createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]));
		const { document } = session;
		const prepared = preparedOf(document.sources);

		render(session, prepared, () => {});

		const before = specs();

		expect(before.sum?.inputs).toHaveLength(2);
		expect(before.difference?.inputs).toHaveLength(2);

		document.sources[0]!.muted = true;
		flush(document);
		render(session, prepared, () => {});

		expect(specs().sum).toBe(before.sum);
		expect(specs().difference).toBe(before.difference);
	});

	it("writes the default difference pair once, outside history", () => {
		const session = createSession(createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]));
		const { document, history } = session;
		const [first, second] = document.sources.map((source) => source.id);
		const prepared = preparedOf(document.sources);
		const context = { session } as unknown as SessionContext;
		const onDefaultDifference = vi.fn((a: string, b: string) => setDifference(a, b, automaticMeta, context));

		render(session, prepared, onDefaultDifference);
		flush(document);

		expect(onDefaultDifference).toHaveBeenCalledExactlyOnceWith(first, second);
		expect([document.differenceA, document.differenceB]).toEqual([first, second]);
		expect(history.length).toBe(0);

		render(session, prepared, onDefaultDifference);
		flush(document);

		expect(onDefaultDifference).toHaveBeenCalledTimes(1);
		expect(history.length).toBe(0);
	});
});
