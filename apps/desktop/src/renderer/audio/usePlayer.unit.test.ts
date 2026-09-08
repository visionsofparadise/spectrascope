import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayer } from "./usePlayer";

const hooks = vi.hoisted(() => ({
	index: 0,
	values: [] as unknown[],
	effects: new Map<number, { deps: readonly unknown[]; cleanup?: () => void }>(),
	pending: [] as Array<() => void>,
}));
const media = vi.hoisted(() => ({
	playing: false,
	positionSec: 3,
	durationSec: 10,
	url: "",
	play: vi.fn(),
	pause: vi.fn(),
	seek: vi.fn(),
	dispose: vi.fn(),
}));

vi.mock("react", () => ({
	useRef: (initial: unknown) => {
		const index = hooks.index++;
		return (hooks.values[index] ??= { current: initial });
	},
	useState: (initial: unknown) => {
		const index = hooks.index++;
		if (!(index in hooks.values)) hooks.values[index] = initial;
		return [
			hooks.values[index],
			(next: unknown) => {
				hooks.values[index] = next;
			},
		];
	},
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
		const index = hooks.index++;
		const prior = hooks.effects.get(index);
		if (prior && deps.every((value, i) => Object.is(value, prior.deps[i]))) return;
		hooks.pending.push(() => {
			prior?.cleanup?.();
			hooks.effects.set(index, { deps, cleanup: effect() });
		});
	},
}));

vi.mock("./PlaybackEngine", () => ({
	PlaybackEngine: class {
		get playing() {
			return media.playing;
		}
		get positionSec() {
			return media.positionSec;
		}
		get durationSec() {
			return media.durationSec;
		}
		play = media.play;
		pause = media.pause;
		seek = media.seek;
		dispose = media.dispose;
		setSourceUrl(url: string, position: number, duration: number) {
			if (url === media.url) return false;
			media.url = url;
			media.positionSec = Math.min(position, duration);
			media.durationSec = duration;
			media.playing = false;
			return true;
		}
		setVolume() {}
		setPlaybackRate() {}
		setLoopRegion() {}
		setLooping() {}
		onPositionChange() {
			return () => {};
		}
		onPlayingChange() {
			return () => {};
		}
		onDurationChange() {
			return () => {};
		}
		onError() {
			return () => {};
		}
	},
}));

function render(url: string | null, preparing = false) {
	hooks.index = 0;
	const result = usePlayer(url, url ? 10 : 0, 3, vi.fn(), 0.8, {
		playbackRate: 1,
		looping: false,
		selection: null,
		preparing,
	});
	for (const effect of hooks.pending.splice(0)) effect();
	return result;
}

beforeEach(() => {
	hooks.index = 0;
	hooks.values = [];
	hooks.effects.clear();
	hooks.pending = [];
	media.playing = false;
	media.url = "";
	media.positionSec = 3;
	media.durationSec = 10;
	media.play.mockReset().mockImplementation(async () => {
		media.playing = true;
	});
	media.pause.mockReset().mockImplementation(() => {
		media.playing = false;
	});
	media.seek.mockReset();
	media.dispose.mockReset();
});

afterEach(() => {
	for (const effect of hooks.effects.values()) effect.cleanup?.();
});

describe("playback stream transitions", () => {
	it("cancels pending startup with the next toggle", async () => {
		let resolvePlay: (() => void) | undefined;
		media.play.mockImplementationOnce(() => {
			media.playing = true;
			return new Promise<void>((resolve) => {
				resolvePlay = resolve;
			});
		});
		const player = render("media://audio");
		player.onPlayToggle();
		player.onPlayToggle();
		expect(media.play).toHaveBeenCalledTimes(1);
		expect(media.pause).toHaveBeenCalledTimes(1);
		expect(media.playing).toBe(false);
		resolvePlay?.();
		await Promise.resolve();
	});

	it("clears deferred resume after an explicit pause during preparation", () => {
		render("media://audio").onPlayToggle();
		render(null, true).onPlayToggle();
		render("media://audio");
		expect(media.play).toHaveBeenCalledTimes(1);
		expect(media.playing).toBe(false);
	});
	it("resumes the same URL after temporary preparation", async () => {
		render("media://audio").onPlayToggle();
		await Promise.resolve();
		render(null, true);
		expect(media.playing).toBe(false);
		render("media://audio");
		await Promise.resolve();
		expect(media.play).toHaveBeenCalledTimes(2);
		expect(media.playing).toBe(true);
	});

	it("drops resume intent when audio is intentionally removed", async () => {
		render("media://audio").onPlayToggle();
		await Promise.resolve();
		render(null, true);
		render(null, false);
		render("media://audio");
		expect(media.play).toHaveBeenCalledTimes(1);
		expect(media.playing).toBe(false);
	});

	it("ignores seek gestures while there is no active playback stream", () => {
		render("media://audio");
		render(null).onSeek(8);
		expect(media.seek).not.toHaveBeenCalled();
	});
});
