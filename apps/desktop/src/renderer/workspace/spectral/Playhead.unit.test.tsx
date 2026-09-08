import { describe, expect, it, vi } from "vitest";
import { Playhead } from "./Playhead";

const playback = vi.hoisted(() => ({ positionSec: 2.5 }));
vi.mock("../playback", () => ({ useWorkspacePlayback: () => playback }));

describe("Playhead", () => {
	it("positions the playback time relative to a placed viewport", () => {
		playback.positionSec = 2.5;
		const result = Playhead({ startMs: 2000, endMs: 4000 });
		expect(result?.props.style.left).toBe("25%");
		expect(result?.props["data-playhead"]).toBe(2.5);
		expect(result?.props.className).toContain("pointer-events-none");
		expect(result?.props.className).toContain("z-40");
	});
	it.each([1, 5, NaN])("hides position %s outside valid coverage", (positionSec) => {
		playback.positionSec = positionSec;
		expect(Playhead({ startMs: 2000, endMs: 4000 })).toBeNull();
	});
	it("hides empty viewports", () => {
		playback.positionSec = 2;
		expect(Playhead({ startMs: 2000, endMs: 2000 })).toBeNull();
	});
});
