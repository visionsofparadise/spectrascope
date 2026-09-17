import { flush } from "opshot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../../models/State/Session";
import { createSavedSession, createSourceFromFile } from "../../session/createSavedSession";
import { MeasurementSessions } from "./MeasurementSession";
import { MeasurementSessionsProvider, useMeasuredSessions } from "./MeasurementSessionsProvider";
import type { Session } from "../../models/State/Session";

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
const queries = vi.hoisted(() => ({
	client: {},
	options: vi.fn((path: string, rate: number | null) => ({ queryKey: ["source-stream", path, rate] })),
	combined: { key: "", value: undefined as unknown },
}));

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useMemo: (compute: () => unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(compute, deps),
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
vi.mock("spectral-display", async (importOriginal) => ({
	...(await importOriginal<typeof import("spectral-display")>()),
	getDevice: vi.fn(() => Promise.resolve({})),
	analyzeMeasurements: vi.fn(),
	runPipeline: vi.fn(),
	SpectralEngine: class {
		destroy() {}
	},
}));
vi.mock("../../audio/utils/streamQueryOptions", () => ({
	initializeStreamQueries: vi.fn(),
	sourceStreamQueryOptions: queries.options,
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => queries.client,
	useQueries: ({ queries: entries }: { queries: Array<{ queryKey: Array<string | number | null> }> }) => {
		const key = JSON.stringify(entries.map((entry) => entry.queryKey));

		if (queries.combined.key !== key) queries.combined = { key, value: entries.map(() => undefined) };

		return queries.combined.value;
	},
}));

const retain = vi.spyOn(MeasurementSessions.prototype, "retain");

function render(sessions: ReadonlyArray<Session>, activeSessionId: string | null): void {
	hooks.cursor.index = 0;

	MeasurementSessionsProvider({
		sessions: useMeasuredSessions(sessions),
		activeSessionId,
		children: null,
	});

	for (const effect of hooks.pending.splice(0)) effect();
}

beforeEach(() => {
	retain.mockClear();
	queries.options.mockClear();
	queries.combined = { key: "", value: undefined };
	hooks.slots.length = 0;
	hooks.effects.clear();
	hooks.pending.length = 0;
	hooks.cursor.index = 0;
});

describe("measurement session retention", () => {
	it("runs again after a source is added, removed and relinked", () => {
		const session = createSession(createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]));
		const { document } = session;

		render([session], session.id);
		expect(retain).toHaveBeenCalledTimes(1);

		document.sources.push(createSourceFromFile("C:/audio/c.wav", 2));
		flush(document);
		render([session], session.id);
		expect(retain).toHaveBeenCalledTimes(2);
		expect(retain.mock.lastCall?.[0][0]?.sources.map((source) => source.audioFilePath)).toEqual([
			"C:/audio/a.wav",
			"C:/audio/b.wav",
			"C:/audio/c.wav",
		]);

		document.sources.splice(0, 1);
		flush(document);
		render([session], session.id);
		expect(retain).toHaveBeenCalledTimes(3);

		document.sources[0]!.audioFilePath = "C:/audio/relinked.wav";
		flush(document);
		render([session], session.id);
		expect(retain).toHaveBeenCalledTimes(4);
		expect(retain.mock.lastCall?.[0][0]?.sources.map((source) => source.audioFilePath)).toEqual([
			"C:/audio/relinked.wav",
			"C:/audio/c.wav",
		]);
	});

	it("stays uncalled after a volume, a selection and a transport write", () => {
		const session = createSession(createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]));
		const { document, transport } = session;

		render([session], session.id);
		expect(retain).toHaveBeenCalledTimes(1);

		document.volume = 0.25;
		document.selection = { start: 1000, end: 4000 };
		flush(document);
		render([session], session.id);

		transport.positionSec = 12;
		transport.looping = true;
		flush(transport);
		render([session], session.id);

		expect(retain).toHaveBeenCalledTimes(1);
	});
});
