import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerMediaProtocol } from "./mediaProtocol";
import { StreamManager } from "./StreamManager";
import { buildWavHeader } from "./audio/wavHeader";

const protocol = vi.hoisted(() => ({ handler: null as ((request: Request) => Promise<Response>) | null }));
vi.mock("electron", () => ({
	protocol: {
		handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => {
			protocol.handler = handler;
		},
	},
}));
let directory: string;
let pcmPath: string;
beforeAll(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-protocol-"));
	pcmPath = path.join(directory, "source.wav");
	const samples = Buffer.alloc(200000 * 4);
	samples.writeFloatLE(0.75, 0);
	await fs.writeFile(pcmPath, Buffer.concat([buildWavHeader(48000, 1, 200000), samples]));
});
afterAll(async () => {
	await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

describe("media stream responses", () => {
	it("serves a shared interleaved range with all channels in one render", async () => {
		const stereoPath = path.join(directory, "stereo.wav");
		const samples = new Float32Array([1, 10, 2, 20, 3, 30]);
		await fs.writeFile(stereoPath, Buffer.concat([buildWavHeader(48000, 2, 3), Buffer.from(samples.buffer)]));
		const manager = new StreamManager();
		try {
			registerMediaProtocol(manager);
			const info = await manager.registerStream({ inputs: [{ pcmPath: stereoPath, offsetMs: 0, gain: 1 }] });
			if (!protocol.handler) throw new Error("Protocol not registered");
			const response = await protocol.handler(
				new Request(`media://stream/${info.key}/raw/interleaved`, { headers: { Range: "bytes=8-23" } }),
			);
			expect(response.status).toBe(206);
			expect(response.headers.get("Content-Range")).toBe("bytes 8-23/24");
			expect([...new Float32Array(await response.arrayBuffer())]).toEqual([2, 20, 3, 30]);
			manager.releaseStream(info.key);
			expect(manager.usesPath(stereoPath)).toBe(false);
		} finally {
			manager.dispose();
		}
	});
	it("bounds open-ended ranges and retains a released registration until cancellation", async () => {
		const manager = new StreamManager();
		try {
			registerMediaProtocol(manager);
			const info = await manager.registerStream({ inputs: [{ pcmPath, offsetMs: 0, gain: 1 }] });
			if (!protocol.handler) throw new Error("Protocol not registered");
			const response = await protocol.handler(
				new Request(`media://stream/${info.key}/audio.wav`, { headers: { Range: "bytes=0-" } }),
			);
			expect(response.status).toBe(206);
			manager.releaseStream(info.key);
			expect(manager.usesPath(pcmPath)).toBe(true);
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Missing response body");
			const first = await reader.read();
			expect(first.value?.byteLength).toBeLessThanOrEqual(65536 * 4);
			await reader.cancel();
			expect(manager.usesPath(pcmPath)).toBe(false);
		} finally {
			manager.dispose();
		}
	});
	it("serves exact raw float ranges and rejects invalid ranges", async () => {
		const manager = new StreamManager();
		try {
			registerMediaProtocol(manager);
			const info = await manager.registerStream({ inputs: [{ pcmPath, offsetMs: 0, gain: 1 }] });
			if (!protocol.handler) throw new Error("Protocol not registered");
			const url = `media://stream/${info.key}/raw/0`;
			const response = await protocol.handler(new Request(url, { headers: { Range: "bytes=0-7" } }));
			expect([...new Float32Array(await response.arrayBuffer())]).toEqual([0.75, 0]);
			const invalid = await protocol.handler(new Request(url, { headers: { Range: "bytes=999999999-" } }));
			expect(invalid.status).toBe(416);
			manager.releaseStream(info.key);
			expect(manager.usesPath(pcmPath)).toBe(false);
		} finally {
			manager.dispose();
		}
	});
});
