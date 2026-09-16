import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ViewLoadingToast } from "./ViewLoadingToast";

it("draws the bar to the reported fraction", () => {
	expect(renderToStaticMarkup(createElement(ViewLoadingToast, { label: "Rendering", fraction: 0.4 }))).toContain(
		"width:40%",
	);
});

it("fills the bar without a fraction and bounds an out-of-range one", () => {
	expect(renderToStaticMarkup(createElement(ViewLoadingToast, { label: "Preparing audio" }))).toContain("width:100%");
	expect(renderToStaticMarkup(createElement(ViewLoadingToast, { label: "Rendering", fraction: -1 }))).toContain(
		"width:0%",
	);
});

it("colours the bar with the source colour", () => {
	expect(
		renderToStaticMarkup(createElement(ViewLoadingToast, { label: "Rendering", color: "#ff0000", fraction: 1 })),
	).toContain("background:#ff0000");
});
