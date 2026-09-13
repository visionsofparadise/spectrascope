export interface SharedWorkLease<T> {
	readonly value: T;
	release(): void;
}

interface Resource<T> {
	readonly value: T;
	readonly dispose: (value: T) => void;
	references: number;
}

interface Entry<T> {
	readonly owner: Owner<T>;
	readonly key: string;
	readonly resource: Resource<T>;
	readonly bytes: number;
}

interface Waiter<T> {
	resolve: (lease: SharedWorkLease<T>) => void;
	reject: (error: Error) => void;
	detach: () => void;
}

interface Job<T> {
	readonly controller: AbortController;
	readonly waiters: Set<Waiter<T>>;
}

interface Owner<T> {
	readonly entries: Map<string, Entry<T>>;
	readonly jobs: Map<string, Job<T>>;
}

function releaseResource<T>(resource: Resource<T>): void {
	resource.references--;

	if (resource.references === 0) resource.dispose(resource.value);
}

function leaseResource<T>(resource: Resource<T>): SharedWorkLease<T> {
	resource.references++;

	let released = false;

	return {
		value: resource.value,
		release() {
			if (released) return;

			released = true;
			releaseResource(resource);
		},
	};
}

export class SharedWorkCache<T> {
	private readonly owners = new WeakMap<object, Owner<T>>();
	private readonly entries = new Set<Entry<T>>();
	private bytes = 0;

	constructor(
		private readonly maximumBytes = 128 * 1024 * 1024,
		private readonly maximumEntries = 256,
	) {}

	get(owner: object, key: string): SharedWorkLease<T> | undefined {
		const entry = this.owners.get(owner)?.entries.get(key);

		if (!entry) return undefined;

		this.entries.delete(entry);
		this.entries.add(entry);

		return leaseResource(entry.resource);
	}

	run(
		owner: object,
		key: string,
		signal: AbortSignal | undefined,
		compute: (signal: AbortSignal) => Promise<T>,
		size: (value: T) => number,
		dispose: (value: T) => void,
	): Promise<SharedWorkLease<T>> {
		if (signal?.aborted)
			return Promise.reject(
				signal.reason instanceof Error ? signal.reason : new DOMException("Work cancelled", "AbortError"),
			);

		const hit = this.get(owner, key);

		if (hit) return Promise.resolve(hit);

		let state = this.owners.get(owner);

		if (!state) {
			state = { entries: new Map(), jobs: new Map() };
			this.owners.set(owner, state);
		}

		const ownerState = state;
		let job = ownerState.jobs.get(key);

		if (!job) {
			job = { controller: new AbortController(), waiters: new Set() };
			ownerState.jobs.set(key, job);

			const pending = job;

			void Promise.resolve().then(async () => {
				try {
					pending.controller.signal.throwIfAborted();

					const value = await compute(pending.controller.signal);
					const resource: Resource<T> = { value, dispose, references: 1 };

					try {
						pending.controller.signal.throwIfAborted();

						const bytes = size(value);

						if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError("Invalid shared work size");

						if (bytes <= this.maximumBytes && this.maximumEntries > 0) {
							const entry: Entry<T> = { owner: ownerState, key, resource, bytes };

							resource.references++;
							ownerState.entries.set(key, entry);
							this.entries.add(entry);
							this.bytes += bytes;
						}

						for (const waiter of pending.waiters) {
							waiter.detach();
							waiter.resolve(leaseResource(resource));
						}

						pending.waiters.clear();
						this.trim();
					} finally {
						releaseResource(resource);
					}
				} catch (error) {
					for (const waiter of pending.waiters) {
						waiter.detach();
						waiter.reject(error instanceof Error ? error : new Error(String(error)));
					}

					pending.waiters.clear();
				} finally {
					if (ownerState.jobs.get(key) === pending) ownerState.jobs.delete(key);
				}
			});
		}

		const pending = job;

		return new Promise((resolve, reject) => {
			const waiter: Waiter<T> = {
				resolve,
				reject,
				detach: () => signal?.removeEventListener("abort", abort),
			};
			const abort = () => {
				if (!pending.waiters.delete(waiter)) return;

				waiter.detach();
				reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Work cancelled", "AbortError"));

				if (pending.waiters.size === 0) {
					if (ownerState.jobs.get(key) === pending) ownerState.jobs.delete(key);

					pending.controller.abort();
				}
			};

			pending.waiters.add(waiter);
			signal?.addEventListener("abort", abort, { once: true });
		});
	}

	private trim(): void {
		while (this.bytes > this.maximumBytes || this.entries.size > this.maximumEntries) {
			const oldest = this.entries.values().next().value;

			if (!oldest) break;

			this.entries.delete(oldest);
			oldest.owner.entries.delete(oldest.key);
			this.bytes -= oldest.bytes;
			releaseResource(oldest.resource);
		}
	}
}
