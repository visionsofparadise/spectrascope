interface PendingBlock {
	controller: AbortController;
	promise: Promise<Float32Array>;
	waiters: number;
}

export class PcmBlockCache {
	private readonly completed = new Map<string, Float32Array>();
	private readonly pending = new Map<string, PendingBlock>();
	private readonly queue = new Set<() => void>();
	private bytes = 0;
	private active = 0;

	constructor(
		private readonly maximumBytes = 32 * 1024 * 1024,
		private readonly maximumEntries = 64,
		private readonly maximumActive = 4,
	) {}

	async read(
		key: string,
		load: (signal: AbortSignal) => Promise<Float32Array>,
		signal?: AbortSignal,
	): Promise<Float32Array> {
		signal?.throwIfAborted();

		const completed = this.completed.get(key);

		if (completed) {
			this.completed.delete(key);
			this.completed.set(key, completed);

			return completed;
		}

		let pending = this.pending.get(key);

		if (!pending) {
			const controller = new AbortController();
			const entry: PendingBlock = {
				controller,
				waiters: 0,
				promise: this.load(key, load, controller.signal),
			};

			this.pending.set(key, entry);
			pending = entry;
			void entry.promise
				.finally(() => {
					if (this.pending.get(key) === entry) this.pending.delete(key);
				})
				.catch(() => undefined);
		}

		const entry = pending;

		entry.waiters++;

		return new Promise((resolve, reject) => {
			let settled = false;
			const release = () => {
				if (settled) return false;

				settled = true;
				signal?.removeEventListener("abort", abort);
				entry.waiters--;

				return true;
			};
			const abort = () => {
				if (!release()) return;

				reject(
					signal?.reason instanceof Error ? signal.reason : new DOMException("Audio read cancelled", "AbortError"),
				);

				if (entry.waiters === 0) {
					if (this.pending.get(key) === entry) this.pending.delete(key);

					entry.controller.abort();
				}
			};

			signal?.addEventListener("abort", abort, { once: true });
			entry.promise.then(
				(value) => {
					if (release()) resolve(value);
				},
				(error: unknown) => {
					if (release()) reject(error instanceof Error ? error : new Error(String(error)));
				},
			);
		});
	}

	private async acquire(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();

		if (this.active < this.maximumActive) {
			this.active++;

			return;
		}

		await new Promise<void>((resolve, reject) => {
			const resume = () => {
				signal.removeEventListener("abort", abort);
				this.active++;
				resolve();
			};
			const abort = () => {
				this.queue.delete(resume);
				reject(
					signal.reason instanceof Error ? signal.reason : new DOMException("Audio read cancelled", "AbortError"),
				);
			};

			this.queue.add(resume);
			signal.addEventListener("abort", abort, { once: true });
		});
	}

	private async load(
		key: string,
		load: (signal: AbortSignal) => Promise<Float32Array>,
		signal: AbortSignal,
	): Promise<Float32Array> {
		await this.acquire(signal);

		try {
			signal.throwIfAborted();

			const samples = await load(signal);

			signal.throwIfAborted();

			if (samples.byteLength <= this.maximumBytes) {
				this.completed.set(key, samples);
				this.bytes += samples.byteLength;

				while (this.bytes > this.maximumBytes || this.completed.size > this.maximumEntries) {
					const oldest = this.completed.entries().next().value;

					if (!oldest) break;

					this.completed.delete(oldest[0]);
					this.bytes -= oldest[1].byteLength;
				}
			}

			return samples;
		} finally {
			this.active--;

			const next = this.queue.values().next().value;

			if (next) {
				this.queue.delete(next);
				next();
			}
		}
	}
}
