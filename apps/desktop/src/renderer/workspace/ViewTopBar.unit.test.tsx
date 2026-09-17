import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createSession } from "../models/State/Session";
import { createSavedSession } from "../session/createSavedSession";
import { INITIAL_VIEW_CONTROL_SETTINGS } from "./viewSettings";
import { ViewTopBar } from "./ViewTopBar";
import type { SessionContext } from "../models/Context";
import type { ViewId } from "./Workspace";

const selects = vi.hoisted(() => new Array<Record<string, unknown>>());

vi.mock("opshot/react", () => ({ scope: (component: unknown) => component }));
vi.mock("../components/Select", () => ({
	Select: (props: Record<string, unknown>) => {
		selects.push(props);

		return null;
	},
}));

const SOURCE_IDS = ["a", "b", "c"];

function render(activeView: ViewId) {
	const saved = createSavedSession(["C:/First", "C:/Second", "C:/Third"]);
	const session = createSession({
		...saved,
		sources: saved.sources.map((source, index) => ({ ...source, id: SOURCE_IDS[index]! })),
		activeView,
		differenceA: "a",
		differenceB: "b",
	});

	selects.length = 0;
	const html = renderToStaticMarkup(createElement(ViewTopBar, { context: { session } as unknown as SessionContext }));

	const find = (ariaLabel: string) => selects.find((props) => props.ariaLabel === ariaLabel);

	return Object.assign(find, { html, session });
}

describe("ViewTopBar", () => {
	it("selects the loudness metric", () => {
		const select = render("loudness");
		const metric = select("Loudness metric")!;
		expect(metric.value).toBe(INITIAL_VIEW_CONTROL_SETTINGS.loudnessMetric);
		const options = metric.options as ReadonlyArray<{ value: string }>;
		const next = options.find((option) => option.value !== INITIAL_VIEW_CONTROL_SETTINGS.loudnessMetric)!.value;
		(metric.onChange as (value: string) => void)(next);
		expect(select.session.document.renderSettings.loudnessMetric).toBe(next);
	});

	it("selects the vectorscope scale", () => {
		const select = render("vectorscope");
		const scale = select("Vectorscope scale")!;
		expect(scale.value).toBe(INITIAL_VIEW_CONTROL_SETTINGS.vectorscopeScale);
		expect(scale.size).toBe("sm");
		(scale.onChange as (value: string) => void)("log");
		expect(select.session.document.renderSettings.vectorscopeScale).toBe("log");
	});

	it("selects the view and the channels", () => {
		const select = render("overlay");
		(select("View")!.onChange as (value: string) => void)("loudness");
		(select("Channels")!.onChange as (value: string) => void)("side");
		expect(select.session.navigation.activeView).toBe("loudness");
		expect(select.session.document.channelInput).toBe("side");
	});

	it("sizes the metric chip as the view and channels chips", () => {
		const selectOf = render("loudness");
		expect(selectOf("Loudness metric")!.size).toBe(selectOf("View")!.size);
		expect(selectOf("Loudness metric")!.size).toBe(selectOf("Channels")!.size);
	});

	it("shows the unpressed sync button on timeline alone", () => {
		const timeline = render("timeline").html;
		expect(timeline).toContain('aria-pressed="false"');
		expect(timeline).toContain("<span>Sync</span>");
		expect(render("overlay").html).not.toContain("<span>Sync</span>");
	});

	it.each(["slider", "sum", "difference"] as const)("keeps the other side when %s changes A or B", (view) => {
		const select = render(view);
		const { document } = select.session;
		(select("Source A")!.onChange as (value: string) => void)("c");
		expect([document.differenceA, document.differenceB]).toEqual(["c", "b"]);
		(select("Source B")!.onChange as (value: string) => void)("c");
		expect([document.differenceA, document.differenceB]).toEqual(["a", "c"]);
	});
});
