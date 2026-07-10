import { describe, expect, it } from "vitest";
import { scheduleSource } from "./MixPlayer";

/**
 * `scheduleSource` is the pure offset-scheduling math behind `MixPlayer` — how
 * a source at a timeline offset is positioned when a run starts at a given
 * playhead. The rest of `MixPlayer` is Web Audio node wiring (no `AudioContext`
 * in the `node` vitest environment); this is the part where an off-by-one in
 * the start-delay / buffer-offset arithmetic would plausibly hide.
 */
describe("scheduleSource", () => {
	it("starts a source at the run head with no delay or offset when the run begins at 0 and the source is at 0", () => {
		// A 10 s source at timeline offset 0, run from 0 — plays whole, immediately.
		expect(scheduleSource(0, 10, 0)).toEqual({ skip: false, startDelaySec: 0, bufferOffsetSec: 0 });
	});

	it("delays a source that has not been reached yet, playing from its buffer head", () => {
		// A source at offset 5 s, run from 2 s — waits 3 s, plays from buffer 0.
		expect(scheduleSource(5, 10, 2)).toEqual({ skip: false, startDelaySec: 3, bufferOffsetSec: 0 });
	});

	it("starts a source mid-buffer when the playhead is already inside its span", () => {
		// A source at offset 2 s, run from 5 s — starts now, 3 s into its buffer.
		expect(scheduleSource(2, 10, 5)).toEqual({ skip: false, startDelaySec: 0, bufferOffsetSec: 3 });
	});

	it("skips a source whose whole span is behind the playhead", () => {
		// A source at offset 0 s of length 4 s, run from 6 s — already finished.
		expect(scheduleSource(0, 4, 6)).toEqual({ skip: true, startDelaySec: 0, bufferOffsetSec: 0 });
	});

	it("skips a source exactly at its end boundary (the run starts on the last sample)", () => {
		// Boundary: sourceEnd === fromSec. The source contributes nothing — `<=`,
		// not `<`, so a run starting exactly at the source's end is a skip.
		expect(scheduleSource(2, 3, 5)).toEqual({ skip: true, startDelaySec: 0, bufferOffsetSec: 0 });
	});

	it("starts a source with zero delay and zero offset when the run begins exactly at its offset", () => {
		// Boundary: offsetSec === fromSec — `>=`, so this is the future-start branch
		// with a zero delay, not the mid-buffer branch.
		expect(scheduleSource(4, 8, 4)).toEqual({ skip: false, startDelaySec: 0, bufferOffsetSec: 0 });
	});
});
