const owners = new WeakMap<GPUTexture, number>();

export function retainTexture(texture: GPUTexture): () => void {
	owners.set(texture, (owners.get(texture) ?? 0) + 1);

	let released = false;

	return () => {
		if (released) return;

		released = true;

		const remaining = (owners.get(texture) ?? 1) - 1;

		if (remaining === 0) {
			owners.delete(texture);
			texture.destroy();
		} else {
			owners.set(texture, remaining);
		}
	};
}
