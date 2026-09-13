import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartSvg, HorizontalGridlines, rangeTransformOf, VerticalGridlines } from "./chartMarks";

describe("chart marks under axis ranges", () => {
	it("keeps full-range gridlines at their fractions", () => {
		const html = renderToStaticMarkup(createElement(HorizontalGridlines, { fractions: [0, 0.5, 1] }));
		expect(html).toContain("top:0%");
		expect(html).toContain("top:50%");
		expect(html).toContain("top:100%");
	});
	it("remaps visible gridlines into the range and hides the rest", () => {
		const range = { start: 0.25, end: 0.75 };
		const horizontal = renderToStaticMarkup(
			createElement(HorizontalGridlines, { fractions: [0.1, 0.25, 0.5, 0.9], range }),
		);
		expect(horizontal.match(/<div/g)).toHaveLength(2);
		expect(horizontal).toContain("top:0%");
		expect(horizontal).toContain("top:50%");
		const vertical = renderToStaticMarkup(createElement(VerticalGridlines, { fractions: [0.2, 0.625], range }));
		expect(vertical.match(/<div/g)).toHaveLength(1);
		expect(vertical).toContain("left:75%");
	});
	it("maps a visible range onto the unit viewBox", () => {
		expect(rangeTransformOf({ start: 0, end: 1 }, { start: 0, end: 1 })).toBe("translate(0 0) scale(1 1)");
		expect(rangeTransformOf({ start: 0.25, end: 0.75 }, { start: 0.5, end: 1 })).toBe(
			"translate(-0.5 -1) scale(2 2)",
		);
		const html = renderToStaticMarkup(
			createElement(ChartSvg, { yRange: { start: 0.5, end: 1 }, children: createElement("polyline") }),
		);
		expect(html).toContain('<g transform="translate(0 -1) scale(1 2)"><polyline>');
	});
});
