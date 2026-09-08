import { useEffect, useState } from "react";

export function physicalSizeOf(width: number, height: number, ratio: number): { width: number; height: number } {
	const scale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

	return { width: Math.max(0, Math.round(width * scale)), height: Math.max(0, Math.round(height * scale)) };
}

export function useContainerSize(
	ref: React.RefObject<HTMLDivElement | null>,
	initial: { width: number; height: number },
): { width: number; height: number } {
	const [size, setSize] = useState(() =>
		physicalSizeOf(initial.width, initial.height, typeof window === "undefined" ? 1 : window.devicePixelRatio),
	);

	useEffect(() => {
		const element = ref.current;

		if (!element) return;

		let dimensions = { width: element.clientWidth, height: element.clientHeight };
		let query: MediaQueryList | undefined;
		const update = () => {
			const next = physicalSizeOf(dimensions.width, dimensions.height, window.devicePixelRatio);

			setSize((previous) => (previous.width === next.width && previous.height === next.height ? previous : next));
		};
		const watchRatio = () => {
			query?.removeEventListener("change", watchRatio);
			query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
			query.addEventListener("change", watchRatio);
			update();
		};
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];

			if (!entry) return;

			dimensions = entry.contentRect;
			update();
		});

		observer.observe(element);
		watchRatio();

		return () => {
			observer.disconnect();
			query?.removeEventListener("change", watchRatio);
		};
	}, [ref]);

	return size;
}
