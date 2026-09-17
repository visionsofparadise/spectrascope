import { describe, expect, it } from "vitest";

import { createGestureKey } from "./gestureKey";

describe("createGestureKey", () => {
	it("returns a stable key within a gesture", () => {
		const key = createGestureKey();

		expect(key.current()).toBe(key.current());
	});

	it("returns a new key after end", () => {
		const key = createGestureKey();
		const first = key.current();

		key.end();

		expect(key.current()).not.toBe(first);
	});

	it("ends with no open key", () => {
		const key = createGestureKey();

		expect(() => {
			key.end();
		}).not.toThrow();
		expect(key.current()).toMatch(/^[0-9a-f-]{36}$/u);
	});
});
