import { createMutableState, flush } from "opshot";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createAppState, INITIAL_PREFERENCES } from "../../models/State/App";
import { createSavedSession } from "../../session/createSavedSession";
import { SelectionSurface } from "../../workspace/spectral/SelectionSurface";
import { SessionTab } from "./Session";
import type { AppContext, SessionContext, SessionStatus } from "../../models/Context";
import type { ComponentProps, KeyboardEvent, ReactElement } from "react";

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

	return { cursor, slots, memoize, effects: new Array<() => unknown>(), onDefaultDifference: new Array<unknown>() };
});

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useMemo: (factory: () => unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(factory, deps),
	useCallback: (callback: unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(() => callback, deps),
	useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()],
	useRef: (value: unknown) => ({ current: value }),
	useEffect: (effect: () => unknown) => {
		hooks.effects.push(effect);
	},
}));
vi.mock("opshot/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("opshot/react")>()),
	scope: (component: unknown) => component,
	useMutableState: (initial: object | (() => object)) =>
		hooks.memoize(() => createMutableState(typeof initial === "function" ? initial() : initial), []),
}));

const SOURCE_STREAMS = {
	sourceAudio: new Map<string, { durationMs: number }>(),
	prepared: new Map(),
	status: new Map(),
	errors: new Map(),
	retrySource: () => {},
};
const DERIVED_STREAMS: Record<string, unknown> = {
	sumAudio: null,
	diffAudio: null,
	sumInfo: null,
	diffInfo: null,
	preparing: false,
	error: null,
	retry: () => {},
};
const PLAYBACK_CONTROLS = {
	onPlayToggle: () => {},
	onSeek: () => {},
};

vi.mock("../../audio/useSourceStreams", () => ({ useSourceStreams: () => SOURCE_STREAMS }));
vi.mock("../../audio/useDerivedStreams", () => ({
	resolveAudibleSources: (sources: unknown) => sources,
	useDerivedStreams: (...parameters: Array<unknown>) => {
		hooks.onDefaultDifference.push(parameters[4]);

		return DERIVED_STREAMS;
	},
}));
vi.mock("../../audio/usePlayer", () => ({ usePlayer: () => PLAYBACK_CONTROLS }));
vi.mock("../../session/utils/relinkSource", () => ({ relinkSource: vi.fn() }));
vi.mock("../../workspace/AppShell", () => ({ AppShell: "mock-app-shell" }));
vi.mock("../../workspace/spectral/MeasurementSession", () => ({ MeasurementSessionProvider: "mock-measurement" }));
vi.mock("../../workspace/spectral/ViewLoadingToast", () => ({ ViewLoadingToast: "mock-toast" }));
vi.mock("../../workspace/spectral/viewProgress", () => ({ PreparingAudioContext: { Provider: "mock-preparing" } }));
vi.mock("../../workspace/Transport", () => ({ Transport: "mock-transport" }));
vi.mock("../../workspace/TransportViewControls", () => ({
	hasTransportViewControls: () => true,
	TransportViewControls: "mock-transport-view-controls",
}));
vi.mock("../../workspace/ViewTopBar", () => ({ ViewTopBar: "mock-view-top-bar" }));
vi.mock("../../workspace/Workspace", () => ({ Workspace: "mock-workspace" }));

function appContextOf(app: AppContext["app"]): AppContext {
	return {
		app,
		sessionStatus: createMutableState<SessionStatus>({ busy: false, error: null }),
		logger: {},
		main: {},
		mainEvents: {},
		queryClient: {},
		userDataPath: "C:/userData",
		openSession: vi.fn(),
		newSession: vi.fn(),
		saveSession: vi.fn(),
		closeSession: vi.fn(),
		renameTab: vi.fn(),
		removeRecentSession: vi.fn(),
	} as unknown as AppContext;
}

function appOf(saved: ReturnType<typeof createSavedSession>): AppContext["app"] {
	return createMutableState(
		createAppState({
			tabs: [{ id: "tab", comparisonId: saved.id }],
			activeTabId: "tab",
			theme: "lava",
			windowBounds: undefined,
			comparisons: [saved],
			preferences: INITIAL_PREFERENCES,
			recentSessions: [],
		}),
	);
}

function elementsOf(node: unknown): Array<ReactElement<Record<string, unknown>>> {
	if (Array.isArray(node)) return node.flatMap(elementsOf);

	if (!isValidElement<Record<string, unknown>>(node)) return [];

	return [node, ...Object.values(node.props).flatMap(elementsOf)];
}

async function scopedContextsOf(context: AppContext, count: number): Promise<Array<AppContext>> {
	const { scope } = await vi.importActual<typeof import("opshot/react")>("opshot/react");
	const received = new Array<AppContext>();
	const Probe = scope<{ readonly context: AppContext }>(({ context: scoped }) => {
		received.push(scoped);

		return null;
	});

	for (let render = 0; render < count; render += 1) renderToStaticMarkup(createElement(Probe, { context }));

	return received;
}

it("keeps the session context and its callbacks across renders that receive a fresh scoped app context", async () => {
	const saved = createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]);
	const app = appOf(saved);
	const session = app.sessions[0]!;
	const appContext = appContextOf(app);
	const [first, second] = await scopedContextsOf(appContext, 2);

	expect(first).not.toBe(second);

	const render = (context: AppContext) => {
		hooks.cursor.index = 0;
		const elements = elementsOf(SessionTab({ session, onExportControlChange: vi.fn(), context }));
		const propsOf = (type: string) => elements.find((element) => element.type === type)!.props;

		return {
			context: propsOf("mock-view-top-bar").context,
			control: propsOf("mock-transport").control,
			workspace: propsOf("mock-workspace"),
		};
	};
	const before = render(first!);
	const after = render(second!);

	expect(after.context).toBe(before.context);

	expect(after.workspace.context).toBe(before.context);
	expect(after.workspace.onRelinkSource).toBe(before.workspace.onRelinkSource);
	expect(after.control).toBe(before.control);
});

it("writes the default difference pair through the context of the render that supplied the callback", () => {
	const saved = createSavedSession(["C:/audio/a.wav", "C:/audio/b.wav"]);
	const app = appOf(saved);
	const session = app.sessions[0]!;

	hooks.cursor.index = 0;
	hooks.slots.length = 0;
	hooks.onDefaultDifference.length = 0;
	SessionTab({ session, onExportControlChange: vi.fn(), context: appContextOf(app) });

	const [first, second] = session.document.sources;
	const onDefaultDifference = hooks.onDefaultDifference[0] as (a: string, b: string) => void;

	onDefaultDifference(first!.id, second!.id);
	flush(session.document);

	expect(session.document.differenceA).toBe(first!.id);
	expect(session.document.differenceB).toBe(second!.id);
	expect(session.history.length).toBe(0);
});

it("bounds a Shift+Arrow extend by the session when the playing stream is shorter", () => {
	class SurfaceElement {
		closest() {
			return this;
		}
	}

	vi.stubGlobal("Element", SurfaceElement);
	vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });

	try {
		const saved = createSavedSession(["C:/audio/long.wav"]);
		const app = appOf(saved);
		const session = app.sessions[0]!;
		const appContext = appContextOf(app);
		const render = () => {
			hooks.cursor.index = 0;
			hooks.effects.length = 0;
			const elements = elementsOf(SessionTab({ session, onExportControlChange: vi.fn(), context: appContext }));

			for (const effect of hooks.effects) effect();

			return elements.find((element) => element.type === "mock-view-top-bar")!.props.context as SessionContext;
		};

		hooks.slots.length = 0;
		render();
		SOURCE_STREAMS.sourceAudio.set(session.document.sources[0]!.id, { durationMs: 10_000 });
		DERIVED_STREAMS.sumInfo = { key: "sum", sampleRate: 48_000, durationMs: 2000 };
		const context = render();

		expect(context.sessionDurationMs).toBe(10_000);

		session.document.selection = { start: 1000, end: 8000 };
		const surface = new SurfaceElement();
		const element = SelectionSurface({ startMs: 0, endMs: 2000, context }) as ReactElement<ComponentProps<"div">>;

		element.props.onKeyDown?.({
			currentTarget: surface,
			target: surface,
			key: "ArrowLeft",
			shiftKey: true,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			defaultPrevented: false,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		} as unknown as KeyboardEvent<HTMLDivElement>);

		expect(session.document.selection).toEqual({ start: 1000, end: 7980 });
	} finally {
		SOURCE_STREAMS.sourceAudio.clear();
		DERIVED_STREAMS.sumInfo = null;
		vi.unstubAllGlobals();
	}
});
