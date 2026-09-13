import { useEffect, useState } from "react";

export function useComputeSize({ width, height }: { readonly width: number; readonly height: number }) {
	const [size, setSize] = useState({ width, height });

	useEffect(() => {
		if (size.width === width && size.height === height) return;

		const timer = setTimeout(() => setSize({ width, height }), 150);

		return () => clearTimeout(timer);
	}, [width, height, size.width, size.height]);

	return size;
}
