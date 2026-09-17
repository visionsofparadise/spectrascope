import { flush } from "opshot";
import { describe, expect, it, vi } from "vitest";
import { createSession } from "../models/State/Session";
import { createSavedSession } from "../session/createSavedSession";
import { hasTransportViewControls, TransportViewControls } from "./TransportViewControls";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "./viewSettings";
import type { SessionContext } from "../models/Context";
import type { Session } from "../models/State/Session";
import type { ReactElement } from "react";
import type { ViewId } from "./Workspace";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()],
}));
vi.mock("opshot/react", () => ({ scope: (component: unknown) => component }));
vi.mock("@iconify/react", () => ({ Icon: "mock-icon" }));
vi.mock("../components/Knob", () => ({ Knob: "mock-knob" }));
vi.mock("../components/Select", () => ({ Select: "mock-select" }));

function elements(node: unknown): Array<ReactElement<Record<string, unknown>>> {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object") return [];
	const element = node as ReactElement<Record<string, unknown>>;
	if (typeof element.type === "function")
		return elements((element.type as (props: unknown) => unknown)(element.props));
	return [element, ...elements(element.props?.children)];
}

function sessionOf(activeView: ViewId, frequencyRange = { top: 0, bottom: 1 }) {
	const saved = createSavedSession([]);

	return createSession({ ...saved, activeView, viewSettings: { ...saved.viewSettings, frequencyRange } });
}

function render(activeView: ViewId, session: Session = sessionOf(activeView)) {
	return elements(TransportViewControls({ context: { session } as unknown as SessionContext }));
}

describe("spectrogram sampling control", () => {
	it.each(["timeline", "slider", "sum", "difference"] as const)("offers every sampling mode in %s", (view) => {
		const nodes = render(view);
		const selector = nodes.find(
			(element) => element.type === "mock-select" && element.props.ariaLabel === "Spectrogram sampling",
		);
		expect(selector?.props.value).toBe("4");
		expect(nodes.some((element) => element.props.children === "Sampling")).toBe(false);
		expect(
			nodes.filter((element) => element.type === "mock-select").map((element) => element.props.ariaLabel),
		).toEqual(["Colour map", "Spectrogram sampling", "Frequency scale", "FFT size", "FFT hop"]);
		expect(selector?.props.variant).toBe("chip");
		expect(selector?.props.direction).toBe("up");
		const help = nodes.find((element) => typeof element.props.title === "string")?.props.title;
		expect(help).toContain("highest-RMS");
		expect(help).toContain("Approximate overview");
		expect(selector?.props.options).toEqual([
			{ value: "1", label: "1×" },
			{ value: "2", label: "2×" },
			{ value: "4", label: "4×" },
			{ value: "8", label: "8×" },
			{ value: "full", label: "Full" },
		]);
	});

	it.each([1, 2, 4, 8, "full"] as const)("commits %s while preserving other display settings", (sampling) => {
		const session = sessionOf("slider");
		const before = { ...session.document.renderSettings };
		const selector = render("slider", session).find((element) => element.props.ariaLabel === "Spectrogram sampling")!;
		(selector.props.onChange as (value: string) => void)(String(sampling));
		expect({ ...session.document.renderSettings }).toEqual({ ...before, spectrogramSampling: sampling });
	});

	it.each([
		["Colour map", "viridis", { spectrogramColormap: "viridis" }, { top: 0.2, bottom: 0.6 }],
		["Frequency scale", "erb", { frequencyScale: "erb" }, { top: 0, bottom: 1 }],
		["FFT size", "8192", { fftSize: 8192 }, { top: 0.2, bottom: 0.6 }],
		["FFT hop", "8", { hopOverlap: 8 }, { top: 0.2, bottom: 0.6 }],
	] as const)("updates Timeline %s using the shared selector", (label, value, changed, frequencyRange) => {
		const session = sessionOf("timeline", { top: 0.2, bottom: 0.6 });
		const before = { ...session.document.renderSettings };
		const selector = render("timeline", session).find((element) => element.props.ariaLabel === label)!;
		(selector.props.onChange as (value: string) => void)(value);
		expect({ ...session.document.renderSettings }).toEqual({ ...before, ...changed });
		expect(session.navigation.frequencyRange).toEqual(frequencyRange);
	});

	it.each(["lava", "viridis"] as const)(
		"selects the standard %s colour map without changing analysis settings",
		(spectrogramColormap) => {
			const session = sessionOf("slider", { top: 0.2, bottom: 0.6 });
			const before = { ...session.document.renderSettings };
			const selector = render("slider", session).find((element) => element.props.ariaLabel === "Colour map")!;
			expect(selector.props.options).toEqual([
				{ value: "lava", label: "Lava" },
				{ value: "viridis", label: "Viridis" },
			]);
			expect(selector.props.value).toBe("lava");
			(selector.props.onChange as (value: string) => void)(spectrogramColormap);
			expect({ ...session.document.renderSettings }).toEqual({ ...before, spectrogramColormap });
			expect(session.navigation.frequencyRange).toEqual({ top: 0.2, bottom: 0.6 });
		},
	);

	it("keeps Overlay controls limited to grid opacity and waveform opacity", () => {
		const session = sessionOf("overlay");
		const nodes = render("overlay", session);
		expect(nodes.some((element) => element.type === "select" || element.type === "mock-select")).toBe(false);
		expect(
			nodes.some(
				(element) =>
					element.props["aria-label"] === "Frequency grid" || element.props["aria-label"] === "Amplitude grid",
			),
		).toBe(false);
		expect(nodes.some((element) => element.props.icon === "lucide:flame")).toBe(false);
		const knobs = nodes.filter((element) => element.type === "mock-knob");
		expect(knobs.map((knob) => knob.props.value)).toEqual([
			INITIAL_VIEW_CONTROL_SETTINGS.gridOpacity,
			INITIAL_VIEW_CONTROL_SETTINGS.waveformOpacity,
		]);
		(knobs[0]!.props.onChange as (value: number) => void)(0.2);
		(knobs[1]!.props.onChange as (value: number) => void)(0.6);
		expect(session.document.renderSettings.gridOpacity).toBe(0.2);
		expect(session.document.renderSettings.waveformOpacity).toBe(0.6);
	});

	it("records one history entry per knob drag", () => {
		const session = sessionOf("slider");
		const knob = render("slider", session).find((element) => element.type === "mock-knob")!;
		const turn = (value: number) => {
			(knob.props.onChange as (value: number) => void)(value);
			flush(session.document);
		};

		turn(0.4);
		turn(0.5);
		turn(0.6);
		expect(session.history.length).toBe(1);
		(knob.props.onChangeEnd as () => void)();
		turn(0.7);
		expect(session.history.length).toBe(2);
	});

	it("omits spectrogram sampling from measurement-only controls", () => {
		expect(render("loudness").some((element) => element.props.ariaLabel === "Spectrogram sampling")).toBe(false);
	});
});

describe("transport view control layout", () => {
	it.each(["timeline", "slider"] as const)("keeps the spectrogram selectors in one row in %s", (view) => {
		const nodes = render(view);
		expect(nodes[0]?.props.className).toContain("gap-2.5");
		const block = nodes.find(
			(element) =>
				element.props.className === "flex items-center gap-1" &&
				elements(element.props.children).some((child) => child.props.ariaLabel === "Colour map"),
		)!;
		expect(String(block.props.className)).not.toContain("flex-wrap");
		const blockNodes = elements(block.props.children);
		expect(
			blockNodes.filter((element) => element.type === "mock-select").map((element) => element.props.ariaLabel),
		).toEqual(["Colour map", "Spectrogram sampling", "Frequency scale", "FFT size", "FFT hop"]);
		const group = blockNodes.find((element) => element.props.className === "flex items-center gap-1")!;
		expect(
			elements(group.props.children)
				.filter((element) => element.type === "mock-select")
				.map((element) => element.props.ariaLabel),
		).toEqual(["Frequency scale", "FFT size", "FFT hop"]);
	});

	it.each(["loudness", "correlation"] as const)("renders nothing for %s", (view) => {
		expect(render(view)).toEqual([]);
	});

	it.each([
		["timeline", true],
		["overlay", true],
		["slider", true],
		["difference", true],
		["sum", true],
		["loudness", false],
		["frequency-distribution", false],
		["correlation", false],
		["vectorscope", false],
	] as const)("reports whether %s has view controls", (view, expected) => {
		expect(hasTransportViewControls(view)).toBe(expected);
		expect(render(view).length > 0).toBe(expected);
	});
});
