import { useEffect, useState } from "react";

export function useContainerSize(
	ref: React.RefObject<HTMLDivElement | null>,
	initial: { width: number; height: number },
): { width: number; height: number } {
	const [size, setSize] = useState(initial);

	useEffect(() => {
		const element = ref.current;

		if (!element) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];

			if (!entry) return;

			setSize({
				width: Math.round(entry.contentRect.width),
				height: Math.round(entry.contentRect.height),
			});
		});

		observer.observe(element);

		return () => {
			observer.disconnect();
		};
	}, [ref]);

	return size;
}
