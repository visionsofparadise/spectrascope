import { beforeEach, expect, it, vi } from "vitest";
import { clampedFractionOf, useReportViewProgress, ViewProgressProvider, viewProgressOf } from "./viewProgress";
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
	readonly render: () => { readonly report: Report; readonly progress: ReturnType<typeof viewProgressOf> };
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
				children: ReactElement<{ value: ReturnType<typeof viewProgressOf>; children: ReactNode }>;
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

it("averages active view progress and is inactive with no reports", () => {
	expect(viewProgressOf([])).toEqual({ active: false, fraction: 0 });
	expect(viewProgressOf([0.2, 0.6])).toEqual({ active: true, fraction: 0.4 });
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
