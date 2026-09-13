import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinearDbAxis } from "./Axes";

function labelsOf(html: string): Array<string> {
	return [...html.matchAll(/<span class="pr-1">([^<]*)<\/span>/g)].map((match) => match[1] ?? "");
}

describe("linear value axis", () => {
	it("renders the full-range ticks top-down", () => {
		const html = renderToStaticMarkup(createElement(LinearDbAxis, { min: -60, max: 0, tickCount: 8, sample: "-60" }));
		expect(labelsOf(html)).toEqual(["0", "-10", "-20", "-30", "-40", "-50", "-60"]);
		expect(html).toContain("top:50%");
	});
	it("regenerates ticks for the visible range and positions them inside it", () => {
		const html = renderToStaticMarkup(
			createElement(LinearDbAxis, {
				min: -60,
				max: 0,
				tickCount: 8,
				range: { start: 0.1, end: 0.4 },
				sample: "-60",
			}),
		);
		expect(labelsOf(html)).toEqual(["-10", "-15", "-20"]);
		expect(html).not.toContain(">0<");
		expect(html).toMatch(/top:(49\.9{6,}\d*|50)%/);
	});
});
