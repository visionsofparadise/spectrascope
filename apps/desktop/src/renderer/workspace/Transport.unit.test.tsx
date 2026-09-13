import { expect, it, vi } from "vitest";
import { Transport } from "./Transport";
import type { ComponentProps, ReactElement } from "react";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "popover-id",
	useRef: (value: unknown) => ({ current: value }),
	useCallback: (callback: unknown) => callback,
}));
vi.mock("@iconify/react", () => ({ Icon: "mock-icon" }));
vi.mock("../components/IconButton", () => ({ IconButton: () => null }));
vi.mock("../components/Select", () => ({ Select: "mock-select" }));
function elements(node: unknown): Array<ReactElement<Record<string, unknown>>> {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object") return [];
	const element = node as ReactElement<Record<string, unknown>>;
	if (typeof element.type === "function")
		return elements((element.type as (props: unknown) => unknown)(element.props));
	return [element, ...elements(element.props?.children)];
}
function render(playing: boolean, toggle: ReturnType<typeof vi.fn>, disabled = false, onPlaybackRateChange = vi.fn()) {
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
			onPlaybackRateChange,
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
	for (const [button, icon] of [
		[before, "lucide:play"],
		[after, "lucide:pause"],
	] as const) {
		expect(button.props.className).toContain("shrink-0 items-center justify-center p-1.5");
		const children = elements(button.props.children);
		expect(children[0]?.props.className).toContain("size-6");
		expect(children.find((element) => element.type === "mock-icon")?.props).toMatchObject({
			icon,
			width: 24,
			height: 24,
		});
		(button.props.onClick as NonNullable<ComponentProps<"button">["onClick"]>)(
			{} as React.MouseEvent<HTMLButtonElement>,
		);
	}
	expect(toggle).toHaveBeenCalledTimes(2);
	const playingChip = elements(after.props.children)[0]!;
	expect(after.props.className).toContain("text-void");
	expect(playingChip.props.className).toContain("bg-primary");
	expect(before.props.className).toContain("text-chrome-text-secondary");
	expect(elements(before.props.children)[0]?.props.className).not.toContain("bg-primary");
	const disabled = render(true, toggle, true).find((element) => element.props["aria-label"] === "Pause")!;
	(disabled.props.onClick as () => void)();
	expect(toggle).toHaveBeenCalledTimes(2);
});
it("keeps compact controls reachable through named native nonmodal popovers", () => {
	const nodes = render(false, vi.fn());
	const region = nodes.find((element) => element.props["aria-label"] === "Transport")!;
	expect(region.props.className).toContain("h-[92px]");
	expect(region.props.className).not.toContain("border-t");
	expect(elements(region.props.children)[0]?.props.className).toContain("px-4");
	for (const label of ["View controls", "Measurements", "Volume"]) {
		const trigger = nodes.find((element) => element.type === "button" && element.props["aria-label"] === label)!;
		expect(
			nodes.some((element) => element.props.id === trigger.props.popoverTarget && element.props.popover === "auto"),
		).toBe(true);
	}
});
it("chooses playback speed through an upward chip selector", () => {
	const onPlaybackRateChange = vi.fn();
	const speed = render(false, vi.fn(), false, onPlaybackRateChange).find(
		(element) => element.type === "mock-select" && element.props.ariaLabel === "Playback speed",
	)!;
	expect(speed.props).toMatchObject({ variant: "chip", size: "sm", direction: "up", value: "1" });
	expect(speed.props.className).toContain("italic");
	expect((speed.props.options as ReadonlyArray<{ label: string }>).map((option) => option.label)).toEqual([
		"0.25x",
		"0.5x",
		"0.75x",
		"1x",
		"1.25x",
		"1.5x",
		"2x",
	]);
	(speed.props.onChange as (value: string) => void)("1.5");
	expect(onPlaybackRateChange).toHaveBeenCalledExactlyOnceWith(1.5);
});
