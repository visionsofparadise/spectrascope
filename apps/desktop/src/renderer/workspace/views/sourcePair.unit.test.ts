import { expect, it } from "vitest";
import { sourcePairOf } from "./sourcePair";

const sources = [{ id: "one" }, { id: "two" }, { id: "three" }];

it("defaults to the first two sources", () => {
	expect(sourcePairOf(sources, null, null)).toEqual({ a: "one", b: "two" });
});

it("keeps valid selections and replaces missing ones", () => {
	expect(sourcePairOf(sources, "three", "one")).toEqual({ a: "three", b: "one" });
	expect(sourcePairOf(sources, "gone", "gone")).toEqual({ a: "one", b: "two" });
	expect(sourcePairOf(sources, "two", null)).toEqual({ a: "two", b: "one" });
});

it("selects only A when there is a single source", () => {
	expect(sourcePairOf([{ id: "one" }], "one", "two")).toEqual({ a: "one", b: null });
	expect(sourcePairOf([], null, null)).toEqual({ a: null, b: null });
});
