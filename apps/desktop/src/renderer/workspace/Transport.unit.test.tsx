import { createMutableState, flush } from "opshot";
import { expect, it, vi } from "vitest";
import { createSession } from "../models/State/Session";
import { createSavedSession } from "../session/createSavedSession";
import { Transport } from "./Transport";
import type { SessionContext } from "../models/Context";
import type { PlaybackControls } from "../models/State/Playback";
import type { Session } from "../models/State/Session";
import type { ComponentProps, ReactElement } from "react";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useId: () => "popover-id",
	useRef: (value: unknown) => ({ current: value }),
	useCallback: (callback: unknown) => callback,
	useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()],
}));
vi.mock("opshot/react", () => ({ scope: (component: unknown) => component }));
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
function render(
	playing: boolean,
	toggle: ReturnType<typeof vi.fn>,
	disabled = false,
	session: Session = createSession(createSavedSession([])),
	durations: { readonly durationSec: number; readonly sessionDurationMs: number } = {
		durationSec: 10,
		sessionDurationMs: 10_000,
	},
	onSeek = vi.fn(),
) {
	const playback = createMutableState({ positionSec: 1, durationSec: durations.durationSec, playing, error: null });
	const playbackControls: PlaybackControls = { onPlayToggle: toggle, onSeek };

	return elements(
		Transport({
			control: {
				disabled,
				readoutRows: [
					{ label: "Time", cursor: "00:01.000", in: "—", out: "—" },
					{ label: "Freq", cursor: "1.0 kHz", in: "—", out: "—" },
				],
			},
			sampleRate: 48000,
			viewControls: <span>Display controls</span>,
			context: {
				session,
				playback,
				playbackControls,
				sessionDurationMs: durations.sessionDurationMs,
			} as unknown as SessionContext,
		}),
	);
}
it("keeps the same fixed button geometry and direct action while Play becomes Pause", () => {
	const toggle = vi.fn();
	const before = render(false, toggle).find((element) => element.props["aria-label"] === "Play")!;
	const after = render(true, toggle).find((element) => element.props["aria-label"] === "Pause")!;
	for (const [button, shapes] of [
		[before, ["path"]],
		[after, ["rect", "rect"]],
	] as const) {
		expect(button.props.className).toContain("shrink-0 items-center justify-center p-1.5");
		const children = elements(button.props.children);
		expect(children[0]?.props.className).toContain("size-6");
		expect(children.some((element) => element.type === "mock-icon")).toBe(false);
		const svg = children.find((element) => element.type === "svg")!;
		expect(svg.props).toMatchObject({
			width: "24",
			height: "24",
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "2",
		});
		expect(
			elements(svg.props.children)
				.filter((element) => element.type !== svg.type)
				.map((element) => element.type)
				.filter((type) => typeof type === "string"),
		).toEqual(shapes);
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
	for (const label of ["View controls", "Volume"]) {
		const trigger = nodes.find((element) => element.type === "button" && element.props["aria-label"] === label)!;
		expect(
			nodes.some((element) => element.props.id === trigger.props.popoverTarget && element.props.popover === "auto"),
		).toBe(true);
	}
});
it("shows, steps and seeks to the end of the stream duration when the session span is longer", () => {
	const onSeek = vi.fn();
	const nodes = render(
		false,
		vi.fn(),
		false,
		createSession(createSavedSession([])),
		{ durationSec: 2, sessionDurationMs: 10_000 },
		onSeek,
	);
	const click = (label: string) =>
		(
			nodes.find((element) => element.type === "button" && element.props["aria-label"] === label)!.props
				.onClick as () => void
		)();

	expect(nodes.some((element) => element.type === "span" && element.props.children === "00:02.000")).toBe(true);
	expect(nodes.some((element) => element.type === "span" && element.props.children === "00:10.000")).toBe(false);
	click("Jump forward five seconds");
	click("Skip to end");
	expect(onSeek.mock.calls).toEqual([[2], [2]]);
});
it("chooses playback speed through an upward chip selector", () => {
	const session = createSession(createSavedSession([]));
	const speed = render(false, vi.fn(), false, session).find(
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
	expect(speed.props.disabled).toBe(false);
	(speed.props.onChange as (value: string) => void)("1.5");
	expect(session.transport.playbackRate).toBe(1.5);
	const disabledSpeed = render(false, vi.fn(), true).find(
		(element) => element.type === "mock-select" && element.props.ariaLabel === "Playback speed",
	)!;
	expect(disabledSpeed.props.disabled).toBe(true);
});
it("records one volume entry per slider gesture, ended on pointer-up and on lost pointer capture", () => {
	const session = createSession(createSavedSession([]));
	const slider = render(false, vi.fn(), false, session).find((element) => element.props.role === "slider")!;
	const press = (key: string) => {
		(slider.props.onKeyDown as (event: unknown) => void)({ key, preventDefault: vi.fn() });
		flush(session.document);
	};

	press("Home");
	press("End");
	expect(session.history.length).toBe(1);
	(slider.props.onPointerUp as () => void)();
	press("Home");
	press("End");
	expect(session.history.length).toBe(2);
	(slider.props.onLostPointerCapture as () => void)();
	press("Home");
	expect(session.history.length).toBe(3);
	expect(session.document.volume).toBe(0);
});
it("records one volume entry for a key gesture ended on key-up and a second for the next key gesture", () => {
	const session = createSession(createSavedSession([]));
	const slider = render(false, vi.fn(), false, session).find((element) => element.props.role === "slider")!;
	const press = (key: string) => {
		(slider.props.onKeyDown as (event: unknown) => void)({ key, preventDefault: vi.fn() });
		flush(session.document);
	};
	const release = () => (slider.props.onKeyUp as () => void)();

	press("Home");
	press("End");
	release();
	expect(session.history.length).toBe(1);
	press("Home");
	release();
	expect(session.history.length).toBe(2);
	expect(session.document.volume).toBe(0);
});
