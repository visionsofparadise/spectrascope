import { expect, it, vi } from "vitest";
import { Transport } from "./Transport";
import type { ComponentProps, ReactElement } from "react";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "popover-id",
	useRef: (value: unknown) => ({ current: value }),
	useCallback: (callback: unknown) => callback,
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("../components/IconButton", () => ({ IconButton: () => null }));
function elements(node: unknown): Array<ReactElement<Record<string, unknown>>> {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object") return [];
	const element = node as ReactElement<Record<string, unknown>>;
	if (typeof element.type === "function")
		return elements((element.type as (props: unknown) => unknown)(element.props));
	return [element, ...elements(element.props?.children)];
}
function render(playing: boolean, toggle: ReturnType<typeof vi.fn>, disabled = false) {
	return elements(
		Transport({
			control: {
				playing,
				disabled,
				positionSec: 1,
				durationSec: 10,
				onPlayToggle: toggle,
				onSeek: vi.fn(),
				readoutSourceName: "Test source",
			},
			playbackRate: 1,
			onPlaybackRateChange: vi.fn(),
			looping: false,
			onLoopingChange: vi.fn(),
			sampleRate: 48000,
			volume: 0.8,
			onVolumeChange: vi.fn(),
			viewControls: <span>Display controls</span>,
		}),
	);
}
it("keeps the same fixed button geometry and direct action while Play becomes Pause", () => {
	const toggle = vi.fn();
	const before = render(false, toggle).find((element) => element.props["aria-label"] === "Play")!;
	const after = render(true, toggle).find((element) => element.props["aria-label"] === "Pause")!;
	for (const button of [before, after]) {
		expect(button.props.className).toContain("h-8 w-8 shrink-0");
		expect(elements(button.props.children).some((element) => element.type === "svg")).toBe(true);
		(button.props.onClick as NonNullable<ComponentProps<"button">["onClick"]>)(
			{} as React.MouseEvent<HTMLButtonElement>,
		);
	}
	expect(toggle).toHaveBeenCalledTimes(2);
	const disabled = render(true, toggle, true).find((element) => element.props["aria-label"] === "Pause")!;
	(disabled.props.onClick as () => void)();
	expect(toggle).toHaveBeenCalledTimes(2);
});
it("keeps compact controls reachable through named native nonmodal popovers", () => {
	const nodes = render(false, vi.fn());
	expect(nodes.find((element) => element.props["aria-label"] === "Transport")?.props.className).toContain("h-[92px]");
	for (const label of ["View controls", "Measurements", "Volume"]) {
		const trigger = nodes.find((element) => element.type === "button" && element.props["aria-label"] === label)!;
		expect(
			nodes.some((element) => element.props.id === trigger.props.popoverTarget && element.props.popover === "auto"),
		).toBe(true);
	}
});
