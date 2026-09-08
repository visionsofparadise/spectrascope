import fs from "fs/promises";
import path from "path";
import { protocol } from "electron";
import { renderRange, type ResolvedStream } from "./audio/streamDsp";
import { buildWavHeader } from "./audio/wavHeader";
import type { StreamManager, StreamLease } from "./StreamManager";

const CONTENT_TYPE_BY_EXT: Readonly<Record<string, string>> = {
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".flac": "audio/flac",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".opus": "audio/ogg",
	".aiff": "audio/aiff",
	".aif": "audio/aiff",
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

function contentTypeForPath(filePath: string): string {
	return CONTENT_TYPE_BY_EXT[path.extname(filePath).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
}

function parseRangeHeader(range: string, fileSize: number): { start: number; end: number } {
	const match = /^bytes=(\d*)-(\d*)$/.exec(range);

	if (!match || (!match[1] && !match[2])) throw new RangeError(`Invalid Range header: ${range}`);

	const start = match[1] ? Number(match[1]) : Math.max(0, fileSize - Number(match[2]));
	const end = match[1] && match[2] ? Math.min(Number(match[2]), fileSize - 1) : fileSize - 1;

	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= fileSize)
		throw new RangeError("Unsatisfiable audio byte range");

	return { start, end };
}

const BYTES_PER_SAMPLE = 4;

const STREAM_SEGMENT_FRAMES = 65536;

function leasedResponse(response: Response, lease: StreamLease): Response {
	if (!response.body) {
		lease.release();

		return response;
	}

	const reader = response.body.getReader();
	let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				pending = reader.read();

				const result = await pending;

				if (cancelled) return;

				if (result.done) {
					lease.release();
					controller.close();
				} else controller.enqueue(result.value);
			} catch (error) {
				lease.release();

				if (!cancelled) controller.error(error);
			}
		},
		async cancel(reason) {
			cancelled = true;

			try {
				await reader.cancel(reason);
				await pending;
			} finally {
				lease.release();
			}
		},
	});

	return new Response(body, { status: response.status, headers: response.headers });
}

function deinterleaveChannel(
	interleaved: Float32Array,
	channelCount: number,
	channel: number,
	frameCount: number,
): Float32Array {
	const channelData = new Float32Array(frameCount);

	for (let frame = 0; frame < frameCount; frame++) {
		channelData[frame] = interleaved[frame * channelCount + channel] ?? 0;
	}

	return channelData;
}

function bufferFromFloats(data: Float32Array, byteStart: number, byteLength: number): Buffer<ArrayBuffer> {
	const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	const body = Buffer.alloc(byteLength);

	body.set(source.subarray(byteStart, byteStart + byteLength));

	return body;
}

function rangeBodyStream(
	resolved: ResolvedStream,
	header: Buffer | null,
	channel: number | null,
	start: number,
	end: number,
): ReadableStream<Uint8Array> {
	const headerLength = header?.length ?? 0;
	const blockAlign = (channel === null ? resolved.outputChannels : 1) * BYTES_PER_SAMPLE;
	let position = start;
	let pending: Promise<void> | null = null;
	let cancelled = false;

	return new ReadableStream<Uint8Array>({
		pull(controller) {
			pending = (async () => {
				if (position > end) {
					controller.close();

					return;
				}

				const last = Math.min(end, position + STREAM_SEGMENT_FRAMES * blockAlign - 1);
				const parts: Array<Buffer> = [];

				if (header && position < headerLength)
					parts.push(header.subarray(position, Math.min(last + 1, headerLength)));

				if (last >= headerLength) {
					const dataStart = Math.max(position, headerLength) - headerLength;
					const dataEnd = last - headerLength;
					const firstFrame = Math.floor(dataStart / blockAlign);
					const frameCount = Math.floor(dataEnd / blockAlign) - firstFrame + 1;
					const frames = await renderRange(resolved, firstFrame, frameCount);
					const data =
						channel === null ? frames : deinterleaveChannel(frames, resolved.outputChannels, channel, frameCount);

					parts.push(bufferFromFloats(data, dataStart - firstFrame * blockAlign, dataEnd - dataStart + 1));
				}

				if (!cancelled) controller.enqueue(Buffer.concat(parts));

				position = last + 1;
			})();

			return pending;
		},
		async cancel() {
			cancelled = true;
			await pending;
		},
	});
}

function wholeBodyResponse(body: ReadableStream<Uint8Array>, contentType: string, total: number): Response {
	return new Response(body, {
		headers: {
			"Content-Type": contentType,
			"Content-Length": String(total),
			"Accept-Ranges": "bytes",
		},
	});
}

function resolveRange(rangeHeader: string, total: number): { start: number; end: number } {
	const parsed = parseRangeHeader(rangeHeader, total);

	return { start: parsed.start, end: Math.min(parsed.end, total - 1) };
}

function serveRaw(resolved: ResolvedStream, channel: number, rangeHeader: string | null): Response {
	const total = resolved.totalFrames * BYTES_PER_SAMPLE;

	if (!rangeHeader)
		return wholeBodyResponse(
			rangeBodyStream(resolved, null, channel, 0, total - 1),
			"application/octet-stream",
			total,
		);

	const { start, end } = resolveRange(rangeHeader, total);

	const body = rangeBodyStream(resolved, null, channel, start, end);

	return new Response(body, {
		status: 206,
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Range": `bytes ${start}-${end}/${total}`,
			"Content-Length": String(end - start + 1),
			"Accept-Ranges": "bytes",
		},
	});
}

function serveWav(resolved: ResolvedStream, rangeHeader: string | null): Response {
	const header = buildWavHeader(resolved.sampleRate, resolved.outputChannels, resolved.totalFrames);
	const blockAlign = resolved.outputChannels * BYTES_PER_SAMPLE;
	const dataBytes = resolved.totalFrames * blockAlign;
	const total = header.length + dataBytes;

	if (!rangeHeader)
		return wholeBodyResponse(rangeBodyStream(resolved, header, null, 0, total - 1), "audio/wav", total);

	const { start, end } = resolveRange(rangeHeader, total);
	const body = rangeBodyStream(resolved, header, null, start, end);

	return new Response(body, {
		status: 206,
		headers: {
			"Content-Type": "audio/wav",
			"Content-Range": `bytes ${start}-${end}/${total}`,
			"Content-Length": String(end - start + 1),
			"Accept-Ranges": "bytes",
		},
	});
}

async function handleStreamRequest(url: URL, request: Request, streamManager: StreamManager): Promise<Response> {
	const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
	const key = segments[0];

	if (key === undefined) return new Response("Malformed stream URL", { status: 404 });

	const lease = await streamManager.acquire(key);

	if (!lease) return new Response(`Unknown stream key ${key}`, { status: 404 });

	const { resolved } = lease;

	try {
		const flavor = segments[1];
		const rangeHeader = request.headers.get("Range");

		if (flavor === "raw") {
			const channel = Number.parseInt(segments[2] ?? "", 10);

			if (!Number.isInteger(channel) || channel < 0 || channel >= resolved.outputChannels) {
				lease.release();

				return new Response(`Invalid stream channel "${segments[2] ?? ""}"`, { status: 404 });
			}

			return leasedResponse(serveRaw(resolved, channel, rangeHeader), lease);
		}

		if (flavor === "audio.wav") return leasedResponse(serveWav(resolved, rangeHeader), lease);

		lease.release();

		return new Response(`Unknown stream flavor "${flavor ?? ""}"`, { status: 404 });
	} catch (error) {
		lease.release();

		if (error instanceof RangeError) return new Response(error.message, { status: 416 });

		throw error;
	}
}

async function handleFileRequest(url: URL, request: Request): Promise<Response> {
	const filePath = decodeURIComponent(url.pathname.replace(/^\//, ""));
	const contentType = contentTypeForPath(filePath);

	const fileHandle = await fs.open(filePath, "r");

	try {
		const stats = await fileHandle.stat();
		const fileSize = stats.size;
		const rangeHeader = request.headers.get("Range");

		if (!rangeHeader) {
			const buffer = Buffer.alloc(fileSize);

			await fileHandle.read(buffer, 0, fileSize, 0);
			await fileHandle.close();

			return new Response(buffer, {
				headers: {
					"Content-Type": contentType,
					"Content-Length": String(fileSize),
					"Accept-Ranges": "bytes",
				},
			});
		}

		const { start, end } = parseRangeHeader(rangeHeader, fileSize);
		const length = end - start + 1;
		const buffer = Buffer.alloc(length);

		await fileHandle.read(buffer, 0, length, start);
		await fileHandle.close();

		return new Response(buffer, {
			status: 206,
			headers: {
				"Content-Type": contentType,
				"Content-Range": `bytes ${start}-${end}/${fileSize}`,
				"Content-Length": String(length),
				"Accept-Ranges": "bytes",
			},
		});
	} catch (error) {
		await fileHandle.close();

		throw error;
	}
}

export function registerMediaProtocol(streamManager: StreamManager): void {
	protocol.handle("media", async (request) => {
		const url = new URL(request.url);

		if (url.host === "stream") return handleStreamRequest(url, request, streamManager);

		return handleFileRequest(url, request);
	});
}
