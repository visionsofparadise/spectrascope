import { createMutableState } from "opshot";
import { describe, expect, it, vi } from "vitest";
import { Playhead } from "./Playhead";
import type { SessionContext } from "../../models/Context";
import type { PlaybackState } from "../../models/State/Playback";
import type { ReactElement } from "react";

vi.mock("opshot/react", () => ({ scope: (component: unknown) => component }));

const playback = createMutableState<PlaybackState>({ positionSec: 2.5, durationSec: 10, playing: false, error: null });
const context = { playback } as unknown as SessionContext;

function render(startMs: number, endMs: number) {
	return Playhead({ startMs, endMs, context }) as ReactElement<{
		readonly style: { readonly left: string };
		readonly "data-playhead": number;
		readonly className: string;
	}> | null;
}

describe("Playhead", () => {
	it("positions the playback time relative to a placed viewport", () => {
		playback.positionSec = 2.5;
		const result = render(2000, 4000);
		expect(result?.props.style.left).toBe("25%");
		expect(result?.props["data-playhead"]).toBe(2.5);
		expect(result?.props.className).toContain("pointer-events-none");
		expect(result?.props.className).toContain("z-40");
	});
	it.each([1, 5, NaN])("hides position %s outside valid coverage", (positionSec) => {
		playback.positionSec = positionSec;
		expect(render(2000, 4000)).toBeNull();
	});
	it("hides empty viewports", () => {
		playback.positionSec = 2;
		expect(render(2000, 2000)).toBeNull();
	});
});
