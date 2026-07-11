import fs from "fs/promises";
import path from "path";
import { protocol } from "electron";
import { renderRange, type ResolvedStream } from "./audio/streamDsp";
import { buildWavHeader } from "./audio/wavHeader";
import type { StreamManager } from "./StreamManager";

/**
 * Custom `media://` protocol — serves any local file to the renderer with
 * HTTP Range support. Recovered from the buffered-audio-graph desktop app
 * (commit `7ce455a`, `apps/desktop/src/main/mediaProtocol.ts`) and adapted:
 * the original always reported `audio/wav`; this version resolves a content
 * type from the file extension so non-WAV imports (mp3/flac/m4a/ogg) decode
 * correctly through `fetch`/`decodeAudioData`.
 *
 * A `media://` URL is `media:///` (triple slash — empty host) + the
 * `encodeURIComponent`-encoded absolute file path (see
 * `renderer/audio/decodeAudio.ts`). The path MUST be percent-encoded and the
 * host empty — a raw Windows path after `media://` parses with the drive
 * letter as the host (`:` lost), and an encoded path after `media://` (no
 * slashes) becomes the host wholesale. The triple slash keeps the host empty
 * so the encoded path lands in `pathname`; the handler strips the leading `/`
 * and `decodeURIComponent`s it back to the original absolute path.
 *
 * `protocol.registerSchemesAsPrivileged` for `media` must be called at the
 * main process's module top level (before `app.whenReady()`); the
 * `registerMediaProtocol()` call here must run after `app.whenReady()`
 * resolves. See `main/index.ts`.
 */

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
	const match = /bytes=(\d+)-(\d*)/.exec(range);

	if (!match) throw new Error(`Invalid Range header: ${range}`);

	const start = parseInt(match[1] ?? "0", 10);
	const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

	return { start, end };
}

/** Bytes per f32 sample — the on-the-wire width of both stream flavors. */
const BYTES_PER_SAMPLE = 4;

/** Frames rendered per pull of a no-Range streamed body. */
const STREAM_SEGMENT_FRAMES = 65536;

function deinterleaveChannel(interleaved: Float32Array, channelCount: number, channel: number, frameCount: number): Float32Array {
	const channelData = new Float32Array(frameCount);

	for (let frame = 0; frame < frameCount; frame++) {
		channelData[frame] = interleaved[frame * channelCount + channel] ?? 0;
	}

	return channelData;
}

/** Copies a byte window of a Float32Array's backing store into an owned Buffer. */
function bufferFromFloats(data: Float32Array, byteStart: number, byteLength: number): Buffer<ArrayBuffer> {
	const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	const body = Buffer.alloc(byteLength);

	body.set(source.subarray(byteStart, byteStart + byteLength));

	return body;
}

function rawChannelStream(resolved: ResolvedStream, channel: number): ReadableStream<Uint8Array> {
	const total = resolved.totalFrames;
	let frame = 0;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (frame >= total) {
				controller.close();

				return;
			}

			const count = Math.min(STREAM_SEGMENT_FRAMES, total - frame);
			const interleaved = await renderRange(resolved, frame, count);
			const channelData = deinterleaveChannel(interleaved, resolved.outputChannels, channel, count);

			controller.enqueue(new Uint8Array(channelData.buffer, channelData.byteOffset, channelData.byteLength));

			frame += count;
		},
	});
}

async function serveRaw(resolved: ResolvedStream, channel: number, rangeHeader: string | null): Promise<Response> {
	const total = resolved.totalFrames * BYTES_PER_SAMPLE;

	if (!rangeHeader) {
		return new Response(rawChannelStream(resolved, channel), {
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Length": String(total),
				"Accept-Ranges": "bytes",
			},
		});
	}

	const parsed = parseRangeHeader(rangeHeader, total);
	const start = parsed.start;
	const end = Math.min(parsed.end, total - 1);

	const frameStart = Math.floor(start / BYTES_PER_SAMPLE);
	const lastFrame = Math.floor(end / BYTES_PER_SAMPLE);
	const frameCount = lastFrame - frameStart + 1;

	const interleaved = await renderRange(resolved, frameStart, frameCount);
	const channelData = deinterleaveChannel(interleaved, resolved.outputChannels, channel, frameCount);
	const sliceStart = start - frameStart * BYTES_PER_SAMPLE;
	const body = bufferFromFloats(channelData, sliceStart, end - start + 1);

	return new Response(body, {
		status: 206,
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Range": `bytes ${start}-${end}/${total}`,
			"Content-Length": String(body.length),
			"Accept-Ranges": "bytes",
		},
	});
}

function wavBodyStream(resolved: ResolvedStream, header: Buffer): ReadableStream<Uint8Array> {
	const total = resolved.totalFrames;
	let frame = 0;
	let headerSent = false;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (!headerSent) {
				controller.enqueue(new Uint8Array(header.buffer, header.byteOffset, header.byteLength));
				headerSent = true;

				return;
			}

			if (frame >= total) {
				controller.close();

				return;
			}

			const count = Math.min(STREAM_SEGMENT_FRAMES, total - frame);
			const interleaved = await renderRange(resolved, frame, count);

			controller.enqueue(new Uint8Array(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength));

			frame += count;
		},
	});
}

async function serveWav(resolved: ResolvedStream, rangeHeader: string | null): Promise<Response> {
	const header = buildWavHeader(resolved.sampleRate, resolved.outputChannels, resolved.totalFrames);
	const blockAlign = resolved.outputChannels * BYTES_PER_SAMPLE;
	const dataBytes = resolved.totalFrames * blockAlign;
	const total = header.length + dataBytes;

	if (!rangeHeader) {
		return new Response(wavBodyStream(resolved, header), {
			headers: {
				"Content-Type": "audio/wav",
				"Content-Length": String(total),
				"Accept-Ranges": "bytes",
			},
		});
	}

	const parsed = parseRangeHeader(rangeHeader, total);
	const start = parsed.start;
	const end = Math.min(parsed.end, total - 1);
	const parts: Array<Buffer> = [];

	if (start < header.length) {
		parts.push(header.subarray(start, Math.min(end, header.length - 1) + 1));
	}

	if (end >= header.length) {
		const dataStart = Math.max(start, header.length) - header.length;
		const dataEnd = end - header.length;
		const frameStart = Math.floor(dataStart / blockAlign);
		const lastFrame = Math.floor(dataEnd / blockAlign);
		const frameCount = lastFrame - frameStart + 1;

		const interleaved = await renderRange(resolved, frameStart, frameCount);
		const sliceStart = dataStart - frameStart * blockAlign;

		parts.push(bufferFromFloats(interleaved, sliceStart, dataEnd - dataStart + 1));
	}

	const body = Buffer.concat(parts);

	return new Response(body, {
		status: 206,
		headers: {
			"Content-Type": "audio/wav",
			"Content-Range": `bytes ${start}-${end}/${total}`,
			"Content-Length": String(body.length),
			"Accept-Ranges": "bytes",
		},
	});
}

async function handleStreamRequest(url: URL, request: Request, streamManager: StreamManager): Promise<Response> {
	const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
	const key = segments[0];

	if (key === undefined) return new Response("Malformed stream URL", { status: 404 });

	const resolved = streamManager.get(key);

	if (resolved === undefined) return new Response(`Unknown stream key ${key}`, { status: 404 });

	const flavor = segments[1];
	const rangeHeader = request.headers.get("Range");

	if (flavor === "raw") {
		const channel = Number.parseInt(segments[2] ?? "", 10);

		if (!Number.isInteger(channel) || channel < 0 || channel >= resolved.outputChannels) {
			return new Response(`Invalid stream channel "${segments[2] ?? ""}"`, { status: 404 });
		}

		return serveRaw(resolved, channel, rangeHeader);
	}

	if (flavor === "audio.wav") return serveWav(resolved, rangeHeader);

	return new Response(`Unknown stream flavor "${flavor ?? ""}"`, { status: 404 });
}

async function handleFileRequest(url: URL, request: Request): Promise<Response> {
	// The caller percent-encodes the whole absolute path into a single URL
	// component; `pathname` carries it with a leading `/`. Decoding it back
	// yields the original absolute path on every platform (Windows drive
	// letters included).
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

		// Host `stream` routes to the virtual DSP endpoints; an empty host is the
		// legacy real-file path (unchanged).
		if (url.host === "stream") return handleStreamRequest(url, request, streamManager);

		return handleFileRequest(url, request);
	});
}
