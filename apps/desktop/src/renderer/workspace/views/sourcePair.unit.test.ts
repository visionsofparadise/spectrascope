import { expect, it } from "vitest";
import { NO_SOURCE, sourcePairOf } from "./sourcePair";

const sources = [{ id: "one" }, { id: "two" }, { id: "three" }];

it("defaults B to the next source that is not A", () => {
	expect(sourcePairOf(sources, null, null)).toEqual({ a: "one", b: "two" });
	expect(sourcePairOf(sources, "two", null)).toEqual({ a: "two", b: "one" });
	expect(sourcePairOf(sources, "gone", "gone")).toEqual({ a: "one", b: "two" });
});

it("keeps a B that matches A or an explicit none", () => {
	expect(sourcePairOf(sources, "three", "three")).toEqual({ a: "three", b: "three" });
	expect(sourcePairOf(sources, "one", NO_SOURCE)).toEqual({ a: "one", b: null });
});

it("defaults B to none when no other source exists", () => {
	expect(sourcePairOf([{ id: "one" }], "one", null)).toEqual({ a: "one", b: null });
	expect(sourcePairOf([{ id: "one" }], "one", "one")).toEqual({ a: "one", b: "one" });
	expect(sourcePairOf([], null, null)).toEqual({ a: null, b: null });
});
