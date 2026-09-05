import type { ComputeResult, ComputeResultReady } from "spectral-display";

export function heldComputeResult(computeResult: ComputeResult): ComputeResultReady | null {
	return computeResult.status === "ready"
		? computeResult
		: computeResult.status === "computing" || computeResult.status === "error"
			? computeResult.previous
			: null;
}
