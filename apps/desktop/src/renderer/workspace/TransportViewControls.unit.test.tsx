import { describe, expect, it, vi } from "vitest";
import { hasTransportViewControls, TransportViewControls } from "./TransportViewControls";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "./viewSettings";
import type { ReactElement } from "react";
import type { ViewId } from "./Workspace";

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

function render(activeView: ViewId, onSettingsChange = vi.fn(), settings = INITIAL_VIEW_CONTROL_SETTINGS) {
	return elements(
		TransportViewControls({
			activeView,
			settings,
			onSettingsChange,
			syncEnabled: true,
			onSyncEnabledChange: vi.fn(),
		}),
	);
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
		const onSettingsChange = vi.fn();
		const selector = render("slider", onSettingsChange).find(
			(element) => element.props.ariaLabel === "Spectrogram sampling",
		)!;
		(selector.props.onChange as (value: string) => void)(String(sampling));
		expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({
			...INITIAL_VIEW_CONTROL_SETTINGS,
			spectrogramSampling: sampling,
		});
	});

	it.each([
		["Colour map", "viridis", { spectrogramColormap: "viridis" }],
		["Frequency scale", "erb", { frequencyScale: "erb", frequencyRange: { top: 0, bottom: 1 } }],
		["FFT size", "4096", { fftSize: 4096 }],
		["FFT hop", "8", { hopOverlap: 8 }],
	] as const)("updates Timeline %s using the shared selector", (label, value, changed) => {
		const onSettingsChange = vi.fn();
		const settings = { ...INITIAL_VIEW_CONTROL_SETTINGS, frequencyRange: { top: 0.2, bottom: 0.6 } };
		const selector = render("timeline", onSettingsChange, settings).find(
			(element) => element.props.ariaLabel === label,
		)!;
		(selector.props.onChange as (value: string) => void)(value);
		expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({ ...settings, ...changed });
	});

	it.each(["lava", "viridis"] as const)(
		"selects the standard %s colour map without changing analysis settings",
		(spectrogramColormap) => {
			const onSettingsChange = vi.fn();
			const settings = { ...INITIAL_VIEW_CONTROL_SETTINGS, frequencyRange: { top: 0.2, bottom: 0.6 } };
			const selector = render("slider", onSettingsChange, settings).find(
				(element) => element.props.ariaLabel === "Colour map",
			)!;
			expect(selector.props.options).toEqual([
				{ value: "lava", label: "Lava" },
				{ value: "viridis", label: "Viridis" },
			]);
			expect(selector.props.value).toBe("lava");
			(selector.props.onChange as (value: string) => void)(spectrogramColormap);
			expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({ ...settings, spectrogramColormap });
		},
	);

	it("keeps Overlay controls limited to sync, grid opacity and waveform opacity", () => {
		const onSettingsChange = vi.fn();
		const nodes = render("overlay", onSettingsChange);
		expect(nodes.some((element) => element.props["aria-label"] === "Disable cross-view sync")).toBe(true);
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
		expect(onSettingsChange.mock.calls).toEqual([
			[{ ...INITIAL_VIEW_CONTROL_SETTINGS, gridOpacity: 0.2 }],
			[{ ...INITIAL_VIEW_CONTROL_SETTINGS, waveformOpacity: 0.6 }],
		]);
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

	it("selects the loudness metric through a label-less upward chip", () => {
		const onSettingsChange = vi.fn();
		const [metric] = render("loudness", onSettingsChange).filter((element) => element.type === "mock-select");
		expect(metric?.props).toMatchObject({
			ariaLabel: "Loudness metric",
			variant: "chip",
			direction: "up",
			menuClassName: "w-40",
		});
		expect(metric?.props.label).toBeUndefined();
		const options = metric?.props.options as ReadonlyArray<{ value: string }>;
		const next = options[options.length - 1]!.value;
		(metric?.props.onChange as (value: string) => void)(next);
		expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({
			...INITIAL_VIEW_CONTROL_SETTINGS,
			loudnessMetric: next,
		});
	});

	it("renders nothing for Correlation", () => {
		expect(render("correlation")).toEqual([]);
	});

	it.each([
		["timeline", true],
		["overlay", true],
		["slider", true],
		["difference", true],
		["sum", true],
		["loudness", true],
		["frequency-distribution", false],
		["correlation", false],
		["vectorscope", false],
	] as const)("reports whether %s has view controls", (view, expected) => {
		expect(hasTransportViewControls(view)).toBe(expected);
		expect(render(view).length > 0).toBe(expected);
	});
});
