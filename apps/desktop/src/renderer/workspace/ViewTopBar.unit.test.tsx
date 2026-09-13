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

function render(activeView: ViewId, onSettingsChange = vi.fn(), onDifferenceChange = vi.fn()) {
	selects.length = 0;
	renderToStaticMarkup(
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
		}),
	);

	return (ariaLabel: string) => selects.find((props) => props.ariaLabel === ariaLabel);
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
