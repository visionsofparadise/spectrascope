import { describe, expect, it, vi } from "vitest";
import { retainTexture } from "./textureOwnership";

describe("texture ownership", () => {
	it("keeps a retired compute texture alive through its mounted canvases", () => {
		const destroy = vi.fn();
		const texture = { destroy } as unknown as GPUTexture;
		const releaseCompute = retainTexture(texture);
		const releaseFront = retainTexture(texture);
		const releaseSecondCanvas = retainTexture(texture);

		releaseCompute();
		releaseFront();
		releaseFront();
		expect(destroy).not.toHaveBeenCalled();
		releaseSecondCanvas();
		expect(destroy).toHaveBeenCalledTimes(1);
		releaseCompute();
		releaseSecondCanvas();
		expect(destroy).toHaveBeenCalledTimes(1);
	});
});
