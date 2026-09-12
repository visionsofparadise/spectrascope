import { describe, expect, it, vi } from "vitest";
import { TransportViewControls } from "./TransportViewControls";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "./viewSettings";
import type { ComponentProps, ReactElement } from "react";
import type { ViewId } from "./Workspace";

vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("../components/Knob", () => ({ Knob: () => null }));
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
	it.each(["timeline", "overlay", "slider", "sum", "difference"] as const)(
		"offers every sampling mode in %s",
		(view) => {
			const nodes = render(view);
			const selector = nodes.find(
				(element) => element.type === "select" && element.props["aria-label"] === "Spectrogram sampling",
			);
			expect(selector?.props.value).toBe("4");
			expect(nodes.some((element) => element.props.children === "Sampling")).toBe(false);
			for (const label of ["Frequency scale", "FFT size", "FFT hop"])
				expect(nodes.some((element) => element.props.ariaLabel === label)).toBe(true);
			expect(selector?.props["title"]).toContain("highest-RMS");
			expect(selector?.props["title"]).toContain("Approximate overview");
			expect(
				nodes
					.filter((element) => element.type === "option")
					.map((option) => [option.props.value, option.props.children]),
			).toEqual([
				["1", "1×"],
				["2", "2×"],
				["4", "4×"],
				["8", "8×"],
				["full", "Full"],
			]);
		},
	);

	it.each([1, 2, 4, 8, "full"] as const)("commits %s while preserving other display settings", (sampling) => {
		const onSettingsChange = vi.fn();
		const selector = render("overlay", onSettingsChange).find((element) => element.type === "select")!;
		(selector.props.onChange as NonNullable<ComponentProps<"select">["onChange"]>)({
			target: { value: String(sampling) },
		} as React.ChangeEvent<HTMLSelectElement>);
		expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({
			...INITIAL_VIEW_CONTROL_SETTINGS,
			spectrogramSampling: sampling,
		});
	});

	it.each([
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

	it("omits spectrogram sampling from measurement-only controls", () => {
		expect(render("loudness").some((element) => element.props["aria-label"] === "Spectrogram sampling")).toBe(false);
	});
});
