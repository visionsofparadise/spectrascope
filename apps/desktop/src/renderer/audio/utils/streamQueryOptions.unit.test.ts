import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	derivedStreamQueryOptions,
	initializeStreamQueries,
	retainStreamQuery,
	sourceStreamQueryOptions,
} from "./streamQueryOptions";

const calls = vi.hoisted(() => ({
	prepareSource: vi.fn(),
	registerStream: vi.fn(),
	releaseStream: vi.fn(),
	releasePreparedSource: vi.fn(),
}));
vi.mock("../../models/Main", () => ({ main: calls }));
const prepared = {
	pcmPath: "/prepared.wav",
	sampleRate: 48000,
	channelCount: 1,
	sampleCount: 10,
	nativeSampleRate: 48000,
	durationMs: 10 / 48,
};
const info = { key: "key", sampleRate: 48000, channelCount: 1, totalFrames: 10, durationMs: 10 / 48 };
let client: QueryClient;
beforeEach(() => {
	vi.resetAllMocks();
	calls.prepareSource.mockResolvedValue(prepared);
	calls.registerStream.mockResolvedValue(info);
	calls.releaseStream.mockResolvedValue(undefined);
	calls.releasePreparedSource.mockResolvedValue(undefined);
	client = new QueryClient();
	initializeStreamQueries(client);
});
afterEach(() => client.clear());

describe("stream query ownership", () => {
	it("releases a completed registration cancelled before query cache acceptance", async () => {
		let stop = (): void => undefined;
		calls.registerStream.mockImplementation(() => {
			queueMicrotask(() => queueMicrotask(() => stop()));
			return Promise.resolve(info);
		});
		const observer = new QueryObserver(client, sourceStreamQueryOptions("/file.wav", 48000));
		stop = observer.subscribe(() => undefined);
		await vi.waitFor(() => expect(calls.releaseStream).toHaveBeenCalledTimes(1));
		expect(calls.releasePreparedSource).toHaveBeenCalledTimes(1);
	});
	it("shares pending preparation across observer changes and publishes completion", async () => {
		let complete: (value: typeof prepared) => void = () => undefined;
		calls.prepareSource.mockReturnValue(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		const options = sourceStreamQueryOptions("/file.wav", 48000);
		const first = new QueryObserver(client, options);
		const stopFirst = first.subscribe(() => undefined);
		const second = new QueryObserver(client, options);
		const stopSecond = second.subscribe(() => undefined);
		stopFirst();
		complete(prepared);
		await vi.waitFor(() => expect(second.getCurrentResult().isSuccess).toBe(true));
		expect(calls.prepareSource).toHaveBeenCalledTimes(1);
		stopSecond();
		await vi.waitFor(() => expect(calls.releaseStream).toHaveBeenCalledWith("key"));
		expect(calls.releasePreparedSource).toHaveBeenCalledWith("/prepared.wav");
	});
	it("releases preparation completing after its query was removed", async () => {
		let complete: (value: typeof prepared) => void = () => undefined;
		calls.prepareSource.mockReturnValue(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		const observer = new QueryObserver(client, sourceStreamQueryOptions("/file.wav", 48000));
		const stop = observer.subscribe(() => undefined);
		stop();
		complete(prepared);
		await vi.waitFor(() => expect(calls.releasePreparedSource).toHaveBeenCalledTimes(1));
		expect(calls.registerStream).not.toHaveBeenCalled();
	});
	it("holds old playback data independently of query eviction", async () => {
		const options = derivedStreamQueryOptions({ inputs: [{ pcmPath: "/prepared.wav", offsetMs: 0, gain: 1 }] });
		const entry = await client.fetchQuery(options);
		const release = retainStreamQuery(entry);
		client.removeQueries({ queryKey: options.queryKey });
		expect(calls.releaseStream).not.toHaveBeenCalled();
		release();
		release();
		await vi.waitFor(() => expect(calls.releaseStream).toHaveBeenCalledTimes(1));
	});
	it("allows explicit retry after a failed preparation", async () => {
		calls.prepareSource.mockRejectedValueOnce(new Error("Missing source file"));
		const options = sourceStreamQueryOptions("/file.wav", 48000);
		await expect(client.fetchQuery(options)).rejects.toThrow("Missing source file");
		const entry = await client.fetchQuery(options);
		expect(entry.prepared).toEqual(prepared);
		expect(calls.prepareSource).toHaveBeenCalledTimes(2);
	});

	it("releases a registration that finishes after its observer is gone", async () => {
		let complete: (value: typeof info) => void = () => undefined;
		calls.registerStream.mockReturnValue(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		const observer = new QueryObserver(client, sourceStreamQueryOptions("/file.wav", 48000));
		const stop = observer.subscribe(() => undefined);
		await vi.waitFor(() => expect(calls.registerStream).toHaveBeenCalledTimes(1));
		stop();
		complete(info);
		await vi.waitFor(() => expect(calls.releaseStream).toHaveBeenCalledTimes(1));
		expect(calls.releasePreparedSource).toHaveBeenCalledTimes(1);
	});

	it("releases replaced query ownership while preserving an independently held entry", async () => {
		const options = derivedStreamQueryOptions({ inputs: [{ pcmPath: "/prepared.wav", offsetMs: 0, gain: 1 }] });
		const observer = new QueryObserver(client, options);
		const stop = observer.subscribe(() => undefined);
		await vi.waitFor(() => expect(observer.getCurrentResult().data).toBeDefined());
		const previous = observer.getCurrentResult().data;
		if (!previous) throw new Error("Missing result");
		const release = retainStreamQuery(previous);
		await observer.refetch();
		expect(calls.registerStream).toHaveBeenCalledTimes(2);
		expect(calls.releaseStream).not.toHaveBeenCalled();
		release();
		expect(calls.releaseStream).toHaveBeenCalledTimes(1);
		stop();
		await vi.waitFor(() => expect(calls.releaseStream).toHaveBeenCalledTimes(2));
	});
});
