import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./index";
import type { AppContext } from "../../models/Context";
import type { ReactElement } from "react";

const runtime = vi.hoisted(() => ({
	effects: [] as Array<() => unknown>,
	setNow: vi.fn(),
	now: 0,
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: () => number) => [runtime.now || initial(), runtime.setNow],
	useEffect: (effect: () => unknown) => {
		runtime.effects.push(effect);
	},
}));
vi.mock("@iconify/react", () => ({ Icon: "mock-icon" }));
vi.mock("../TerrainShader", () => ({ TerrainShader: "mock-terrain" }));

const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const MINUTE_MS = 60_000;

function texts(node: unknown): Array<string> {
	if (typeof node === "string") return [node];
	if (Array.isArray(node)) return node.flatMap(texts);
	if (!node || typeof node !== "object") return [];
	return texts((node as ReactElement<{ children?: unknown }>).props.children);
}

function render() {
	runtime.effects = [];
	const context = {
		app: {
			theme: "lava",
			recentSessions: [
				{ name: "Mix", filePath: "C:/mix.scope", lastOpenedAt: new Date(NOW - 5 * MINUTE_MS).toISOString() },
			],
		},
		busy: false,
	} as unknown as AppContext;
	return texts(HomeScreen({ context }));
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	runtime.now = 0;
	runtime.setNow.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("home recent sessions", () => {
	it("labels sessions against the refreshed clock every minute until unmount", () => {
		expect(render()).toContain("5 minutes ago");
		const cleanup = runtime.effects[0]!() as () => void;
		vi.advanceTimersByTime(MINUTE_MS - 1);
		expect(runtime.setNow).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(runtime.setNow).toHaveBeenCalledExactlyOnceWith(NOW + MINUTE_MS);
		runtime.now = NOW + MINUTE_MS;
		expect(render()).toContain("6 minutes ago");
		cleanup();
		vi.advanceTimersByTime(5 * MINUTE_MS);
		expect(runtime.setNow).toHaveBeenCalledTimes(1);
	});
});
