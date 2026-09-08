import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { main } from "../../models/Main";
import { createStreamAudioData } from "../streamAudioData";
import type { StreamSpec } from "../../../main/audio/streamDsp";
import type { PreparedSource } from "../../../main/SourceCacheManager";
import type { StreamInfo } from "../../../main/StreamManager";
import type { AudioData } from "../../workspace/spectral/types";

export interface StreamQueryEntry {
	readonly info: StreamInfo;
	readonly audioData: AudioData;
	readonly prepared: PreparedSource | null;
}

interface EntryOwnership {
	owners: number;
	readonly dispose: () => void;
	readonly accept: () => void;
	readonly releaseQuery: () => void;
}

const ownership = new WeakMap<object, EntryOwnership>();
const clients = new WeakSet<QueryClient>();

function releaseEntry(entry: object): void {
	const state = ownership.get(entry);

	if (!state || state.owners === 0) return;

	state.owners--;

	if (state.owners === 0) state.dispose();
}

export function retainStreamQuery(entry: StreamQueryEntry): () => void {
	const state = ownership.get(entry);

	if (!state || state.owners === 0) throw new Error("Audio stream has been released");

	state.owners++;

	let released = false;

	return () => {
		if (released) return;

		released = true;
		releaseEntry(entry);
	};
}

export function initializeStreamQueries(client: QueryClient): void {
	if (clients.has(client)) return;

	clients.add(client);

	const entries = new WeakMap<object, object>();

	client.getQueryCache().subscribe((event) => {
		if (event.type !== "removed" && event.type !== "updated") return;

		const data: unknown = event.query.state.data;
		const previous = entries.get(event.query);

		if (previous && (previous !== data || event.type === "removed")) ownership.get(previous)?.releaseQuery();

		if (event.type === "removed" || typeof data !== "object" || data === null) entries.delete(event.query);
		else {
			ownership.get(data)?.accept();
			entries.set(event.query, data);
		}
	});
}

async function registerEntry(
	spec: StreamSpec,
	prepared: PreparedSource | null,
	signal: AbortSignal,
): Promise<StreamQueryEntry> {
	let info: StreamInfo;

	try {
		signal.throwIfAborted();
		info = await main.registerStream(spec);
	} catch (error) {
		if (prepared) await main.releasePreparedSource(prepared.pcmPath);

		throw error;
	}

	const entry: StreamQueryEntry = { info, prepared, audioData: createStreamAudioData(info) };
	let queryOwned = true;
	const releaseQuery = (): void => {
		if (!queryOwned) return;

		queryOwned = false;
		signal.removeEventListener("abort", releaseQuery);
		releaseEntry(entry);
	};

	ownership.set(entry, {
		owners: 1,
		releaseQuery,
		accept: () => signal.removeEventListener("abort", releaseQuery),
		dispose: () => {
			void main
				.releaseStream(info.key)
				.then(() => (prepared ? main.releasePreparedSource(prepared.pcmPath) : undefined))
				.catch(console.error);
		},
	});
	signal.addEventListener("abort", releaseQuery, { once: true });

	if (signal.aborted) {
		releaseQuery();
		signal.throwIfAborted();
	}

	return entry;
}

const QUERY_SETTINGS = {
	staleTime: Infinity,
	gcTime: 0,
	retry: false,
	networkMode: "always",
	refetchOnWindowFocus: false,
	structuralSharing: false,
} as const;

export function sourceStreamQueryOptions(filePath: string, rate: number | null) {
	return queryOptions({
		...QUERY_SETTINGS,
		queryKey: ["source-stream", filePath, rate],
		queryFn: async ({ signal }) => {
			const prepared = await main.prepareSource(filePath, rate);

			return registerEntry({ inputs: [{ pcmPath: prepared.pcmPath, offsetMs: 0, gain: 1 }] }, prepared, signal);
		},
	});
}

export function derivedStreamQueryOptions(spec: StreamSpec | null) {
	return queryOptions({
		...QUERY_SETTINGS,
		queryKey: ["derived-stream", spec],
		enabled: spec !== null,
		queryFn: ({ signal }) => {
			if (!spec) throw new Error("No audio selected");

			return registerEntry(spec, null, signal);
		},
	});
}
