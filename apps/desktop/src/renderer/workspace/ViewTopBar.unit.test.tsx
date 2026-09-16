import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "./viewSettings";
import { ViewTopBar } from "./ViewTopBar";
import type { Source } from "./source";
import type { ViewId } from "./Workspace";

const selects = vi.hoisted(() => new Array<Record<string, unknown>>());

vi.mock("../components/Select", () => ({
	Select: (props: Record<string, unknown>) => {
		selects.push(props);

		return null;
	},
}));

const SOURCES = [
	{ id: "a", name: "First" },
	{ id: "b", name: "Second" },
	{ id: "c", name: "Third" },
] as unknown as ReadonlyArray<Source>;

function render(
	activeView: ViewId,
	onSettingsChange = vi.fn(),
	onDifferenceChange = vi.fn(),
	onSyncEnabledChange = vi.fn(),
) {
	selects.length = 0;
	const html = renderToStaticMarkup(
		createElement(ViewTopBar, {
			activeView,
			onActiveViewChange: vi.fn(),
			channelInput: "mono",
			onChannelInputChange: vi.fn(),
			settings: INITIAL_VIEW_CONTROL_SETTINGS,
			onSettingsChange,
			sources: SOURCES,
			differenceA: "a",
			differenceB: "b",
			onDifferenceChange,
			syncEnabled: false,
			onSyncEnabledChange,
		}),
	);

	const find = (ariaLabel: string) => selects.find((props) => props.ariaLabel === ariaLabel);

	find.html = html;

	return find;
}

describe("ViewTopBar", () => {
	it("selects the loudness metric", () => {
		const onSettingsChange = vi.fn();
		const metric = render("loudness", onSettingsChange)("Loudness metric")!;
		expect(metric.value).toBe(INITIAL_VIEW_CONTROL_SETTINGS.loudnessMetric);
		const options = metric.options as ReadonlyArray<{ value: string }>;
		const next = options.find((option) => option.value !== INITIAL_VIEW_CONTROL_SETTINGS.loudnessMetric)!.value;
		(metric.onChange as (value: string) => void)(next);
		expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({ loudnessMetric: next });
	});

	it("selects the vectorscope scale", () => {
		const onSettingsChange = vi.fn();
		const scale = render("vectorscope", onSettingsChange)("Vectorscope scale")!;
		expect(scale.value).toBe(INITIAL_VIEW_CONTROL_SETTINGS.vectorscopeScale);
		expect(scale.size).toBe("sm");
		(scale.onChange as (value: string) => void)("log");
		expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({ vectorscopeScale: "log" });
	});

	it("keeps the metric chip at the default size", () => {
		expect(render("loudness")("Loudness metric")!.size).toBeUndefined();
	});

	it("shows the sync toggle on timeline alone", () => {
		expect(render("timeline").html).toContain('aria-label="Enable cross-view sync"');
		expect(render("overlay").html).not.toContain("cross-view sync");
	});

	it.each(["slider", "sum", "difference"] as const)("keeps the other side when %s changes A or B", (view) => {
		const onDifferenceChange = vi.fn();
		const select = render(view, vi.fn(), onDifferenceChange);
		(select("Source A")!.onChange as (value: string) => void)("c");
		(select("Source B")!.onChange as (value: string) => void)("c");
		expect(onDifferenceChange.mock.calls).toEqual([
			["c", "b"],
			["a", "c"],
		]);
	});
});
