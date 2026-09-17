import { describe, expect, it, vi } from "vitest";
import { CursorSurface } from "./CursorSurface";
import type { SessionContext } from "../../models/Context";

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
}));

describe("CursorSurface", () => {
	it("enables playback seeking while publishing the inspection cursor", () => {
		const onCursorChange = vi.fn();
		const context = {} as SessionContext;
		const result = CursorSurface({ startMs: 2000, endMs: 4000, cursorMs: null, onCursorChange, context });
		expect(result.props.seekOnClick).toBe(true);
		expect(result.props["aria-valuenow"]).toBeUndefined();
		expect(result.props.context).toBe(context);
		result.props.onClick({
			currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 200 }) },
			clientX: 150,
		});
		expect(onCursorChange).toHaveBeenCalledExactlyOnceWith(2500);
	});
});
