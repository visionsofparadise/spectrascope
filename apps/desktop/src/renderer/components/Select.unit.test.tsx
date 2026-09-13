import { beforeEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";
import type { ComponentProps, ReactElement } from "react";

const runtime = vi.hoisted(() => ({
	index: 0,
	slots: [] as Array<{ current: unknown }>,
	effects: [] as Array<() => unknown>,
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const slot = (runtime.slots[runtime.index++] ??= { current: initial });
		return [
			slot.current,
			(next: unknown) => {
				slot.current = typeof next === "function" ? (next as (previous: unknown) => unknown)(slot.current) : next;
			},
		];
	},
	useRef: (initial: unknown) => (runtime.slots[runtime.index++] ??= { current: initial }),
	useCallback: (callback: unknown) => callback,
	useId: () => "select-id",
	useEffect: (effect: () => unknown) => {
		runtime.effects.push(effect);
	},
}));
vi.mock("@iconify/react", () => ({ Icon: "mock-icon" }));

type TreeElement = ReactElement<Record<string, unknown>>;

const OPTIONS = [
	{ value: "a", label: "A" },
	{ value: "b", label: "B" },
	{ value: "c", label: "C" },
	{ value: "d", label: "D" },
];

function elements(node: unknown): Array<TreeElement> {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object") return [];
	const element = node as TreeElement;
	return [element, ...elements(element.props?.children)];
}

function focusable() {
	return { focus: vi.fn() };
}

function render(props: Partial<ComponentProps<typeof Select>> = {}) {
	runtime.index = 0;
	runtime.effects = [];
	const nodes = elements(
		Select({ variant: "chip", ariaLabel: "Letter", value: "b", options: OPTIONS, onChange: vi.fn(), ...props }),
	);
	const trigger = nodes.find((element) => element.props["aria-haspopup"] === "listbox")!;
	const listbox = nodes.find((element) => element.props.role === "listbox");
	const optionElements = nodes.filter((element) => element.props.role === "option");
	return { nodes, trigger, listbox, options: optionElements };
}

function runEffects() {
	return runtime.effects.map((effect) => effect());
}

function attach(view: ReturnType<typeof render>) {
	const trigger = focusable();
	(view.trigger.props.ref as { current: unknown }).current = trigger;
	const options = view.options.map((option) => {
		const target = focusable();
		(option.props.ref as (element: unknown) => void)(target);
		return target;
	});
	return { trigger, options };
}

function open(props: Partial<ComponentProps<typeof Select>> = {}) {
	(render(props).trigger.props.onClick as () => void)();
	const view = render(props);
	return { view, targets: attach(view) };
}

function keyDown(view: ReturnType<typeof render>, index: number, key: string) {
	const event = { key, preventDefault: vi.fn() };
	(view.options[index]!.props.onKeyDown as (event: unknown) => void)(event);
	return event;
}

beforeEach(() => {
	runtime.slots = [];
	runtime.index = 0;
	runtime.effects = [];
	vi.unstubAllGlobals();
});

describe("select", () => {
	it("links the trigger to its listbox", () => {
		const { view } = open();
		expect(view.trigger.props["aria-controls"]).toBe("select-id");
		expect(view.trigger.props["aria-expanded"]).toBe(true);
		expect(view.listbox?.props.id).toBe("select-id");
	});

	it("renders no menu while disabled and closes an open menu when disabled", () => {
		const { view } = open();
		expect(view.listbox).toBeDefined();
		const disabled = render({ disabled: true });
		expect(disabled.listbox).toBeUndefined();
		expect(disabled.options).toEqual([]);
		expect(disabled.trigger.props["aria-expanded"]).toBe(false);
		runEffects();
		expect(render().listbox).toBeUndefined();
	});

	it("focuses the selected option when the menu opens", () => {
		const { view, targets } = open();
		expect(view.options.map((option) => option.props.tabIndex)).toEqual([-1, 0, -1, -1]);
		vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
		runEffects();
		expect(targets.options[1]!.focus).toHaveBeenCalledOnce();
	});

	it("moves focus through the options with arrows, Home and End", () => {
		const { view, targets } = open();
		for (const [from, key, to] of [
			[1, "ArrowDown", 2],
			[2, "ArrowUp", 1],
			[1, "End", 3],
			[3, "ArrowDown", 3],
			[1, "Home", 0],
			[0, "ArrowUp", 0],
		] as const) {
			targets.options[to]!.focus.mockClear();
			expect(keyDown(view, from, key).preventDefault).toHaveBeenCalledOnce();
			expect(targets.options[to]!.focus).toHaveBeenCalledOnce();
		}
		expect(keyDown(view, 1, "a").preventDefault).not.toHaveBeenCalled();
	});

	it("returns focus to the trigger on selection", () => {
		const onChange = vi.fn();
		const { view, targets } = open({ onChange });
		(view.options[2]!.props.onClick as () => void)();
		expect(onChange).toHaveBeenCalledExactlyOnceWith("c");
		expect(targets.trigger.focus).toHaveBeenCalledOnce();
		expect(render({ onChange }).listbox).toBeUndefined();
	});

	it("returns focus to the trigger on Escape", () => {
		const { targets } = open();
		const listeners = new Map<string, (event: unknown) => void>();
		vi.stubGlobal("document", {
			addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
			removeEventListener: vi.fn(),
		});
		runEffects();
		listeners.get("keydown")!({ key: "Escape" });
		expect(targets.trigger.focus).toHaveBeenCalledOnce();
		expect(render().listbox).toBeUndefined();
	});
});
