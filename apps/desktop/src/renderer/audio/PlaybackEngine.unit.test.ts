import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackEngine } from "./PlaybackEngine";

class AudioElement extends EventTarget {
	static instances: Array<AudioElement> = [];
	// eslint-disable-next-line id-denylist
	src = "";
	crossOrigin = "";
	preload = "";
	currentTime = 0;
	duration = NaN;
	readyState = 0;
	paused = true;
	playbackRate = 1;
	error: { code: number } | null = null;
	play = vi.fn(() => {
		this.paused = false;
		return Promise.resolve();
	});
	pause = vi.fn(() => {
		this.paused = true;
	});
	load = vi.fn();
	removeAttribute = vi.fn();
	constructor() {
		super();
		AudioElement.instances.push(this);
	}
	metadata(duration: number) {
		this.duration = duration;
		this.readyState = 1;
		this.dispatchEvent(new Event("loadedmetadata"));
	}
}

class AudioGraph {
	state = "running";
	destination = {};
	resume = vi.fn(() => Promise.resolve());
	close = vi.fn(() => Promise.resolve());
	createMediaElementSource() {
		return { connect: vi.fn(), disconnect: vi.fn() };
	}
	createGain() {
		return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
	}
}

describe("PlaybackEngine", () => {
	let frames: Map<number, FrameRequestCallback>;
	let nextFrame: number;
	let player: PlaybackEngine;
	let audio: AudioElement;
	beforeEach(() => {
		frames = new Map();
		nextFrame = 0;
		AudioElement.instances = [];
		vi.stubGlobal("Audio", AudioElement);
		vi.stubGlobal("AudioContext", AudioGraph);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.set(++nextFrame, callback);
			return nextFrame;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
		player = new PlaybackEngine();
		const instance = AudioElement.instances[0];
		if (!instance) throw new Error("Expected an audio element");
		audio = instance;
	});
	afterEach(() => {
		player.dispose();
		vi.unstubAllGlobals();
	});
	it("restores position when replacement metadata arrives", () => {
		player.setSourceUrl("media://first", 7.5, 20);
		expect(player.positionSec).toBe(7.5);
		expect(audio.currentTime).toBe(0);
		audio.metadata(20);
		expect(audio.currentTime).toBe(7.5);
		player.setSourceUrl("media://second", 7.5, 5);
		audio.metadata(5);
		expect(audio.currentTime).toBe(5);
		expect(player.durationSec).toBe(5);
	});
	it("clamps seeks including invalid and sub-sample input", () => {
		player.setSourceUrl("media://audio", 0, 10);
		audio.metadata(10);
		player.seek(11);
		expect(player.positionSec).toBe(10);
		player.seek(-1);
		expect(player.positionSec).toBe(0);
		player.seek(NaN);
		expect(player.positionSec).toBe(0);
		player.seek(1 / 48000);
		expect(player.positionSec).toBe(1 / 48000);
	});
	it("loops the selected region from an animation boundary", async () => {
		player.setSourceUrl("media://audio", 0, 10);
		audio.metadata(10);
		player.setLoopRegion({ startSec: 2, endSec: 4 });
		player.setLooping(true);
		await player.play();
		audio.currentTime = 4.1;
		const frame = frames.values().next().value;
		frame?.(0);
		expect(audio.currentTime).toBe(2);
		expect(player.playing).toBe(true);
	});
	it("loops a whole stream at natural end", async () => {
		player.setSourceUrl("media://audio", 0, 10);
		audio.metadata(10);
		player.setLooping(true);
		await player.play();
		audio.currentTime = 10;
		audio.dispatchEvent(new Event("ended"));
		await Promise.resolve();
		expect(audio.currentTime).toBe(0);
		expect(audio.play).toHaveBeenCalledTimes(2);
	});
	it("ignores an obsolete rejected play after source replacement", async () => {
		player.setSourceUrl("media://first", 0, 10);
		let rejectPlay: ((reason: Error) => void) | undefined;
		audio.play.mockImplementationOnce(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectPlay = reject;
				}),
		);
		const pending = player.play();
		player.setSourceUrl("media://second", 3, 10);
		rejectPlay?.(new Error("old request aborted"));
		await expect(pending).resolves.toBeUndefined();
		expect(frames.size).toBe(0);
	});
	it("sets bounded playback rate and reports media failure", () => {
		player.setPlaybackRate(1.5);
		expect(audio.playbackRate).toBe(1.5);
		player.setPlaybackRate(20);
		expect(audio.playbackRate).toBe(2);
		const error = vi.fn();
		player.onError(error);
		audio.error = { code: 4 };
		audio.dispatchEvent(new Event("error"));
		expect(error).toHaveBeenCalledWith(expect.stringContaining("cannot be played"));
	});
	it.each([0, 6, 10])("starts inside the selected loop after a paused seek to %i seconds", async (position) => {
		player.setSourceUrl("media://audio", 0, 10);
		audio.metadata(10);
		player.setLoopRegion({ startSec: 2, endSec: 4 });
		player.setLooping(true);
		player.seek(position);
		await player.play();
		expect(audio.currentTime).toBe(2);
	});
	it("clips a loop that partially extends beyond the active stream", async () => {
		player.setSourceUrl("media://audio", 0, 10);
		audio.metadata(10);
		player.setLoopRegion({ startSec: 8, endSec: 15 });
		player.setLooping(true);
		await player.play();
		expect(audio.currentTime).toBe(8);
		audio.currentTime = 10;
		audio.dispatchEvent(new Event("ended"));
		await Promise.resolve();
		expect(audio.currentTime).toBe(8);
	});
	it.each([
		{ startSec: 12, endSec: 15 },
		{ startSec: 4, endSec: 2 },
		{ startSec: NaN, endSec: 4 },
	])("falls back to the full stream for invalid loop $startSec–$endSec", async (region) => {
		player.setSourceUrl("media://audio", 0, 10);
		audio.metadata(10);
		player.setLoopRegion(region);
		player.setLooping(true);
		player.seek(10);
		await player.play();
		expect(audio.currentTime).toBe(0);
		audio.currentTime = 10;
		audio.dispatchEvent(new Event("ended"));
		await Promise.resolve();
		expect(audio.currentTime).toBe(0);
	});
});
