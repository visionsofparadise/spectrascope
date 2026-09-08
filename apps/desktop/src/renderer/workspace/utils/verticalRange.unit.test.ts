import { expect, it } from "vitest";
import { verticalFractionOf } from "./verticalRange";

it("maps waveform extrema and silence through the shared vertical crop", () => {
	expect(verticalFractionOf(0)).toBe(0);
	expect(verticalFractionOf(1)).toBe(1);
	expect(verticalFractionOf(0.5, { top: 0.25, bottom: 0.75 })).toBe(0.5);
	expect(verticalFractionOf(0.25, { top: 0.25, bottom: 0.75 })).toBe(0);
	expect(verticalFractionOf(0.75, { top: 0.25, bottom: 0.75 })).toBe(1);
});

it("keeps offscreen amplitude ticks outside the crop instead of pinning them at its edge", () => {
	expect(verticalFractionOf(0, { top: 0.25, bottom: 0.75 })).toBe(-0.5);
	expect(verticalFractionOf(1, { top: 0.25, bottom: 0.75 })).toBe(1.5);
});
