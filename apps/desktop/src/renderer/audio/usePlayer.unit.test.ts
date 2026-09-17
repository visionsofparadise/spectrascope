import { createMutableState, flush } from "opshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession } from "../models/State/Session";
import { createSavedSession } from "../session/createSavedSession";
import { usePlayer } from "./usePlayer";
import type { PlaybackState } from "../models/State/Playback";
import type { Session } from "../models/State/Session";

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
	positionListener: (_position: number) => {},
	durationListener: (_duration: number) => {},
	play: vi.fn(),
	pause: vi.fn(),
	seek: vi.fn(),
	dispose: vi.fn(),
	setVolume: vi.fn(),
	setLoopRegion: vi.fn(),
	setLooping: vi.fn(),
}));

vi.mock("react", () => ({
	useRef: (initial: unknown) => {
		const index = hooks.index++;
		return (hooks.values[index] ??= { current: initial });
	},
	useState: (initial: unknown) => {
		const index = hooks.index++;
		if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
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
		setVolume = media.setVolume;
		setPlaybackRate() {}
		setLoopRegion = media.setLoopRegion;
		setLooping = media.setLooping;
		onPositionChange(listener: (position: number) => void) {
			media.positionListener = listener;
			return () => {
				media.positionListener = () => {};
			};
		}
		onPlayingChange() {
			return () => {};
		}
		onDurationChange(listener: (duration: number) => void) {
			media.durationListener = listener;
			return () => {
				media.durationListener = () => {};
			};
		}
		onError() {
			return () => {};
		}
	},
}));

let playback = createMutableState<PlaybackState>({ positionSec: 3, durationSec: 0, playing: false, error: null });
let session: Session = createSession(createSavedSession([]));

function render(url: string | null, preparing = false, selection: { start: number; end: number } | null = null) {
	hooks.index = 0;
	const result = usePlayer(url, url ? 10 : 0, preparing, selection, playback, session);
	for (const effect of hooks.pending.splice(0)) effect();
	return result;
}

beforeEach(() => {
	hooks.index = 0;
	hooks.values = [];
	hooks.effects.clear();
	hooks.pending = [];
	playback = createMutableState<PlaybackState>({ positionSec: 3, durationSec: 0, playing: false, error: null });
	session = createSession(createSavedSession([]));
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
	media.setVolume.mockReset();
	media.setLoopRegion.mockReset();
	media.setLooping.mockReset();
});

afterEach(() => {
	for (const effect of hooks.effects.values()) effect.cleanup?.();
});

describe("playback stream transitions", () => {
	it.each([true, false])(
		"retains seconds and playing=%s when a higher-rate derived stream replaces the held stream",
		async (playing) => {
			const player = render("media://stream/44100/wav");
			if (playing) player.onPlayToggle();
			media.positionSec = 6.25;
			media.positionListener(6.25);
			render("media://stream/44100/wav", true);
			expect(media.positionSec).toBe(6.25);
			expect(media.playing).toBe(playing);
			render("media://stream/96000/wav");
			await Promise.resolve();
			expect(media.url).toBe("media://stream/96000/wav");
			expect(media.positionSec).toBe(6.25);
			expect(media.playing).toBe(playing);
			expect(media.play).toHaveBeenCalledTimes(playing ? 2 : 0);
		},
	);

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

describe("session state reaching the engine", () => {
	it("follows a selection edit with the loop region and ignores an unrelated document write", () => {
		const { document } = session;

		document.selection = { start: 1000, end: 4000 };
		render("media://audio", false, document.selection);
		expect(media.setLoopRegion).toHaveBeenLastCalledWith({ startSec: 1, endSec: 4 });
		media.setLoopRegion.mockClear();
		document.selection = { start: 2000, end: 5000 };
		render("media://audio", false, document.selection);
		expect(media.setLoopRegion).toHaveBeenCalledExactlyOnceWith({ startSec: 2, endSec: 5 });
		media.setLoopRegion.mockClear();
		document.name = "Renamed";
		flush(document);
		render("media://audio", false, document.selection);
		expect(media.setLoopRegion).not.toHaveBeenCalled();
	});

	it("reaches the engine with a volume write and with the undo of one", () => {
		const { document, history } = session;
		const initial = document.volume;

		render("media://audio");
		media.setVolume.mockClear();
		document.volume = 0.25;
		flush(document);
		expect(media.setVolume).toHaveBeenLastCalledWith(0.25);
		history.undo();
		flush(document);
		expect(media.setVolume).toHaveBeenLastCalledWith(initial);
		expect(media.setVolume).toHaveBeenCalledTimes(2);
	});
});

describe("stream duration", () => {
	it("follows the stream, the engine's reported duration and a removed stream", () => {
		render("media://audio");
		expect(playback.durationSec).toBe(10);
		media.durationListener(9.5);
		expect(playback.durationSec).toBe(9.5);
		render(null);
		expect(playback.durationSec).toBe(0);
	});
});
