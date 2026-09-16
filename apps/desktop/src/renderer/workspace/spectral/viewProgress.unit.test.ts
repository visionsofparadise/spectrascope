import { beforeEach, expect, it, vi } from "vitest";
import { clampedFractionOf, useReportViewProgress, viewProgressOf, ViewProgressProvider } from "./viewProgress";
import type { ViewProgress } from "./viewProgress";
import type { ReactElement, ReactNode } from "react";

const hooks = vi.hoisted(() => ({
	context: null as unknown,
	state: { current: undefined as unknown },
	effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useContext: () => hooks.context,
	useState: (initial: () => unknown) => {
		const cell = hooks.state;

		if (cell.current === undefined) cell.current = initial();

		return [
			cell.current,
			(update: (previous: unknown) => unknown) => {
				cell.current = update(cell.current);
			},
		];
	},
	useCallback: (callback: unknown) => callback,
	useMemo: (factory: () => unknown) => factory(),
	useId: () => "report",
	useEffect: (effect: () => void | (() => void)) => {
		hooks.effects.push(effect);
	},
}));

type Report = (key: string, fraction: number | null) => void;

interface ProviderInstance {
	readonly cell: { current: unknown };
	readonly render: () => { readonly report: Report; readonly progress: ViewProgress };
}

function mountProvider(parent: Report | null): ProviderInstance {
	const cell = { current: undefined as unknown };

	return {
		cell,
		render: () => {
			hooks.context = parent;
			hooks.state = cell;
			const outer = ViewProgressProvider({ children: null }) as ReactElement<{
				value: Report;
				children: ReactElement<{ value: ViewProgress; children: ReactNode }>;
			}>;

			return { report: outer.props.value, progress: outer.props.children.props.value };
		},
	};
}

beforeEach(() => {
	hooks.context = null;
	hooks.effects = [];
});

it.each([
	[-1, 0],
	[0.42, 0.42],
	[1.5, 1],
	[NaN, 0],
])("bounds progress %s to %s", (fraction, expected) => {
	expect(clampedFractionOf(fraction)).toBe(expected);
});

it("averages the reported fractions", () => {
	expect(viewProgressOf([])).toEqual({ active: false, fraction: 0 });
	expect(viewProgressOf([0.25])).toEqual({ active: true, fraction: 0.25 });
	expect(viewProgressOf([0.2, 0.6])).toEqual({ active: true, fraction: 0.4 });
});

it("is active while any reporter is computing and inactive once all clear", () => {
	const provider = mountProvider(null);

	expect(provider.render().progress).toEqual({ active: false, fraction: 0 });

	provider.render().report("a", 0.2);
	provider.render().report("b", 0.6);
	provider.render().report("a", null);

	expect(provider.render().progress).toEqual({ active: true, fraction: 0.6 });

	provider.render().report("b", null);

	expect(provider.render().progress).toEqual({ active: false, fraction: 0 });
});

it("forwards a nested provider's reports to the enclosing provider", () => {
	const outer = mountProvider(null);
	const inner = mountProvider(outer.render().report);

	inner.render().report("strip", 0.5);

	expect(inner.render().progress).toEqual({ active: true, fraction: 0.5 });
	expect(outer.render().progress).toEqual({ active: true, fraction: 0.5 });

	inner.render().report("strip", null);

	expect(inner.render().progress).toEqual({ active: false, fraction: 0 });
	expect(outer.render().progress).toEqual({ active: false, fraction: 0 });
});

it("clears a reporter's progress from nested providers when it unmounts", () => {
	const outer = mountProvider(null);
	const inner = mountProvider(outer.render().report);

	hooks.context = inner.render().report;
	hooks.effects = [];
	useReportViewProgress(0.25);

	const cleanups = hooks.effects.map((effect) => effect());

	expect(outer.render().progress).toEqual({ active: true, fraction: 0.25 });

	cleanups.forEach((cleanup) => cleanup?.());

	expect(inner.render().progress).toEqual({ active: false, fraction: 0 });
	expect(outer.render().progress).toEqual({ active: false, fraction: 0 });
});
