import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "../components/DropdownMenu";
import { IconButton } from "../components/IconButton";
import { LayerColorPicker } from "./LayerColorPicker";
import { createDefaultSource } from "./source";
import { TimelineTrackHeader } from "./TimelineTrackHeader";
import type { Source } from "./source";
import type { TimelineOffsetHandle } from "./TimelineTrackHeader";
import type { ReactElement, ReactNode } from "react";

const runtime = vi.hoisted(() => ({
	menuOpen: false,
	setMenuOpen: (_open: boolean) => {},
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: () => [runtime.menuOpen, runtime.setMenuOpen],
}));

type AnyElement = ReactElement<Record<string, unknown>>;

function elementsOf(node: ReactNode): Array<AnyElement> {
	if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementsOf(child));

	if (!isValidElement<Record<string, unknown>>(node)) return [];

	return [node, ...elementsOf(node.props.children as ReactNode)];
}

function textOf(element: AnyElement): string {
	const children = element.props.children;

	return typeof children === "string" ? children : "";
}

function render(source: Source, props: Partial<Parameters<typeof TimelineTrackHeader>[0]> = {}) {
	return elementsOf(TimelineTrackHeader({ source, top: "0px", offsetMs: 0, ...props }));
}

function iconButtonOf(elements: Array<AnyElement>, label: string) {
	const button = elements.find((element) => element.type === IconButton && element.props.label === label);

	if (!button) throw new Error(`missing ${label}`);

	return button.props as { onClick: () => void };
}

function menuItemOf(elements: Array<AnyElement>, text: string) {
	return elements.find((element) => element.type === DropdownMenuItem && textOf(element) === text);
}

const offsetHandle: TimelineOffsetHandle = {
	valueMaxMs: 1000,
	onPointerDown: () => {},
	onKeyDown: () => {},
	onKeyUp: () => {},
	onBlur: () => {},
};

describe("Timeline track header", () => {
	beforeEach(() => {
		runtime.menuOpen = false;
		runtime.setMenuOpen = vi.fn();
	});

	it.each([
		["Hide source", { visible: false }],
		["Mute source", { muted: true }],
		["Solo source", { soloed: true }],
	] as const)("%s flips its flag through onSourceChange", (label, change) => {
		const source = createDefaultSource(0, { id: "take" });
		const onSourceChange = vi.fn();

		iconButtonOf(render(source, { onSourceChange }), label).onClick();

		expect(onSourceChange).toHaveBeenCalledExactlyOnceWith(change);
	});

	it("removes the source and replaces its audio from the actions menu", () => {
		const onRemove = vi.fn();
		const onRelink = vi.fn();
		const elements = render(createDefaultSource(0), { onRemove, onRelink });

		(menuItemOf(elements, "Remove source")?.props.onSelect as () => void)();
		(menuItemOf(elements, "Replace audio…")?.props.onSelect as () => void)();

		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(onRelink).toHaveBeenCalledTimes(1);
		expect(menuItemOf(render(createDefaultSource(0)), "Replace audio…")).toBeUndefined();
	});

	it("makes the name chip a slider only when the offset handle is draggable", () => {
		const source = createDefaultSource(0, { name: "Take" });
		const sliderOf = (elements: Array<AnyElement>) => elements.find((element) => element.props.role === "slider");

		expect(sliderOf(render(source, { offsetHandle }))?.props["aria-label"]).toBe("Timeline offset for Take");
		expect(sliderOf(render(source))).toBeUndefined();
	});

	it("opens the layer colour picker in the menu's portalled sub content and applies a colour", () => {
		const source = createDefaultSource(0, { id: "take" });
		const onSourceChange = vi.fn();
		const elements = render(source, { onSourceChange });
		const menu = elements.find((element) => element.type === DropdownMenu);

		(menu?.props.onOpenChange as (open: boolean) => void)(true);
		expect(runtime.setMenuOpen).toHaveBeenCalledWith(true);

		runtime.menuOpen = true;
		const opened = render(source, { onSourceChange });

		expect(opened.find((element) => element.type === DropdownMenu)?.props.open).toBe(true);
		expect(
			opened.some((element) => element.type === DropdownMenuSubTrigger && textOf(element) === "Layer colour"),
		).toBe(true);

		const subContent = opened.find((element) => element.type === DropdownMenuSubContent);
		const picker = elementsOf(subContent?.props.children as ReactNode).find(
			(element) => element.type === LayerColorPicker,
		);
		const nextColor = { primary: "#112233", secondary: "#445566" };

		(picker?.props.onChange as (next: typeof nextColor) => void)(nextColor);

		expect(onSourceChange).toHaveBeenCalledExactlyOnceWith({ layerColor: nextColor });
		expect(runtime.setMenuOpen).toHaveBeenLastCalledWith(false);
		expect(opened.some((element) => String(element.props.className ?? "").includes("top-full"))).toBe(false);
	});
});
