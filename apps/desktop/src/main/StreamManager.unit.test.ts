import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StreamManager } from "./StreamManager";
import { renderRange } from "./audio/streamDsp";
import { buildWavHeader } from "./audio/wavHeader";

let directory: string;
let pcmPath: string;
beforeAll(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "spectrascope-stream-"));
	pcmPath = path.join(directory, "source.wav");
	const samples = Buffer.alloc(8);
	samples.writeFloatLE(0.75, 0);
	samples.writeFloatLE(-0.5, 4);
	await fs.writeFile(pcmPath, Buffer.concat([buildWavHeader(1000, 1, 2), samples]));
});
afterAll(async () => {
	await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

describe("StreamManager ownership", () => {
	it("resets window ownership while active responses and a recreated window remain usable", async () => {
		const manager = new StreamManager();
		try {
			const spec = { inputs: [{ pcmPath, offsetMs: 0, gain: 1 as const }] };
			const original = await manager.registerStream(spec);
			const lease = await manager.acquire(original.key);
			if (!lease) throw new Error("Missing stream");
			manager.reset();
			expect([...(await renderRange(lease.resolved, 0, 2))]).toEqual([0.75, -0.5]);
			const recreated = await manager.registerStream(spec);
			lease.release();
			expect(manager.usesPath(pcmPath)).toBe(true);
			const current = await manager.acquire(recreated.key);
			if (!current) throw new Error("Missing recreated stream");
			expect([...(await renderRange(current.resolved, 0, 2))]).toEqual([0.75, -0.5]);
			current.release();
			manager.releaseStream(recreated.key);
			expect(manager.usesPath(pcmPath)).toBe(false);
		} finally {
			manager.dispose();
		}
	});
	it("rehydrates a registered URL after more than 32 other configurations", async () => {
		const manager = new StreamManager();
		try {
			const first = await manager.registerStream({ inputs: [{ pcmPath, offsetMs: 0, gain: 1 }] });
			for (let offsetMs = 1; offsetMs < 40; offsetMs++)
				await manager.registerStream({ inputs: [{ pcmPath, offsetMs, gain: 1 }] });
			const lease = await manager.acquire(first.key);
			expect(lease).toBeDefined();
			if (!lease) throw new Error("Missing stream");
			expect([...(await renderRange(lease.resolved, 0, 2))]).toEqual([0.75, -0.5]);
			lease.release();
		} finally {
			manager.dispose();
		}
	}, 15000);
	it("retains handles and PCM identity while an active read outlives its registration", async () => {
		const manager = new StreamManager();
		try {
			const info = await manager.registerStream({ inputs: [{ pcmPath, offsetMs: 0, gain: 1 }] });
			const lease = await manager.acquire(info.key);
			if (!lease) throw new Error("Missing stream");
			manager.releaseStream(info.key);
			expect(manager.usesPath(pcmPath)).toBe(true);
			expect([...(await renderRange(lease.resolved, 0, 2))]).toEqual([0.75, -0.5]);
			lease.release();
			lease.release();
			expect(manager.usesPath(pcmPath)).toBe(false);
			expect(await manager.acquire(info.key)).toBeUndefined();
		} finally {
			manager.dispose();
		}
	});
	it("shares concurrent registration and releases each owner once", async () => {
		const manager = new StreamManager();
		try {
			const spec = { inputs: [{ pcmPath, offsetMs: 0, gain: 1 as const }] };
			const [first, second] = await Promise.all([manager.registerStream(spec), manager.registerStream(spec)]);
			expect(first.key).toBe(second.key);
			manager.releaseStream(first.key);
			expect(manager.usesPath(pcmPath)).toBe(true);
			manager.releaseStream(second.key);
			expect(manager.usesPath(pcmPath)).toBe(false);
		} finally {
			manager.dispose();
		}
	});
});
