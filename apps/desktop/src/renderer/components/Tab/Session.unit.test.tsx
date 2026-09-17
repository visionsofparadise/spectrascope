import { createMutableState } from "opshot";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createAppState, INITIAL_PREFERENCES } from "../../models/State/App";
import { createSavedSession } from "../../session/createSavedSession";
import { SessionTab } from "./Session";
import type { AppContext, SessionStatus } from "../../models/Context";
import type { ReactElement } from "react";

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

	return { cursor, memoize, onDefaultDifference: new Array<unknown>() };
});

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useMemo: (factory: () => unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(factory, deps),
	useCallback: (callback: unknown, deps: ReadonlyArray<unknown>) => hooks.memoize(() => callback, deps),
	useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()],
	useRef: (value: unknown) => ({ current: value }),
	useEffect: () => {},
}));
vi.mock("opshot/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("opshot/react")>()),
	scope: (component: unknown) => component,
}));

const SOURCE_STREAMS = {
	sourceAudio: new Map(),
	prepared: new Map(),
	status: new Map(),
	errors: new Map(),
	retrySource: () => {},
};
const DERIVED_STREAMS = {
	sumAudio: null,
	diffAudio: null,
	sumInfo: null,
	diffInfo: null,
	preparing: false,
	error: null,
	retry: () => {},
};
const PLAYER = {
	playing: false,
	positionSec: 0,
	durationSec: 0,
	onPlayToggle: () => {},
	onSeek: () => {},
	onVolumeChange: () => {},
	error: null,
};

vi.mock("../../audio/useSourceStreams", () => ({ useSourceStreams: () => SOURCE_STREAMS }));
vi.mock("../../audio/useDerivedStreams", () => ({
	resolveAudibleSources: (sources: unknown) => sources,
	useDerivedStreams: (...parameters: Array<unknown>) => {
		hooks.onDefaultDifference.push(parameters[4]);

		return DERIVED_STREAMS;
	},
}));
vi.mock("../../audio/usePlayer", () => ({ usePlayer: () => PLAYER }));
vi.mock("../../session/pickAudioFiles", () => ({ pickAudioFiles: vi.fn() }));
vi.mock("../../session/utils/relinkSource", () => ({ relinkSource: vi.fn() }));
vi.mock("../../workspace/AppShell", () => ({ AppShell: "mock-app-shell" }));
vi.mock("../../workspace/playback", () => ({ WorkspacePlaybackProvider: "mock-playback" }));
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
	const app = createMutableState(
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
	const session = app.sessions[0]!;
	const appContext = {
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
	const [first, second] = await scopedContextsOf(appContext, 2);

	expect(first).not.toBe(second);

	const render = (context: AppContext) => {
		hooks.cursor.index = 0;
		const elements = elementsOf(SessionTab({ session, onExportControlChange: vi.fn(), context }));
		const propsOf = (type: string) => elements.find((element) => element.type === type)!.props;

		return {
			context: propsOf("mock-view-top-bar").context,
			workspace: propsOf("mock-workspace"),
			playback: propsOf("mock-playback").value as Record<string, unknown>,
		};
	};
	const before = render(first!);
	const after = render(second!);

	expect(after.context).toBe(before.context);

	for (const callback of ["onRelinkSource", "onSourceRemove", "onAddSources", "onAddSourceFiles"]) {
		expect(after.workspace[callback]).toBe(before.workspace[callback]);
	}

	expect(after.playback.onSelectionChange).toBe(before.playback.onSelectionChange);
	expect(hooks.onDefaultDifference[1]).toBe(hooks.onDefaultDifference[0]);
});
