import fs from "fs/promises";
import path from "path";
import { protocol } from "electron";

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

export function registerMediaProtocol(): void {
	protocol.handle("media", async (request) => {
		const url = new URL(request.url);
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
	});
}
