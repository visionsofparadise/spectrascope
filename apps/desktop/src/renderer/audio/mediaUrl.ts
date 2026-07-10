/**
 * Build a `media://` URL for a local audio file path.
 *
 * The form is `media:///` (triple slash — empty host) followed by the
 * `encodeURIComponent`-encoded absolute path. A raw path after `media://`
 * would have its first segment (a Windows drive letter) parsed as the URL
 * host, dropping the `:`; an encoded path after `media://` has no slashes so
 * the *whole* encoded string would become the host. The triple slash leaves
 * the host empty so the encoded path lands in `pathname`, where the main
 * process `mediaProtocol.ts` handler strips the leading `/` and
 * `decodeURIComponent`s it back to the original absolute path.
 *
 * Every `media://` consumer builds URLs through this single helper —
 * `decodeAudio` (the renderer decode path) and the `PlaybackEngine` (the
 * `<audio>` element `src`). See `main/mediaProtocol.ts`.
 */
export function toMediaUrl(filePath: string): string {
	return `media:///${encodeURIComponent(filePath)}`;
}
