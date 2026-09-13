import type { ComputeResultReady } from "spectral-display";

const resultKeys = new WeakMap<ComputeResultReady, number>();
let nextKey = 0;

export function displayResultKey(result: ComputeResultReady): number {
	let key = resultKeys.get(result);

	if (key === undefined) {
		key = nextKey++;
		resultKeys.set(result, key);
	}

	return key;
}
