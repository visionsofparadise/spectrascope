import { describe, expect, it, vi } from "vitest";
import { useChartView } from "./chartView";
import type { ChartAxis } from "./chartView";
import type { AudioData } from "./types";

const runtime = vi.hoisted(() => ({ setCursor: vi.fn() }));

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: () => [{ start: 0.5, end: 1 }, vi.fn()],
	useCallback: (callback: unknown) => callback,
	useMemo: (factory: () => unknown) => factory(),
}));

vi.mock("./viewScaffold", () => ({
	useViewportScrub: () => ({ viewport: { startMs: 0, endMs: 1000 } }),
	useTransportPlayback: () => ({}),
	usePublishedTransportControl: () => {},
}));

vi.mock("./firstComputeProgress", () => ({
	useFirstComputeProgress: () => ({}),
}));

vi.mock("./useChartReadouts", () => ({
	useChartReadouts: () => ({ setCursor: runtime.setCursor, control: {}, onTraceChange: vi.fn() }),
}));

describe("chart view cursor", () => {
	it("maps the cursor to the full-range value fraction through the visible range", () => {
		const chart = useChartView({} as AudioData, { primary: "#ffffff", secondary: "#000000" }, {} as ChartAxis);
		const rect = { left: 0, top: 100, width: 400, height: 200 };

		chart.handleChartMouseMove({
			clientX: 100,
			clientY: 200,
			currentTarget: { getBoundingClientRect: () => rect },
		} as unknown as React.MouseEvent<HTMLDivElement>);

		expect(runtime.setCursor).toHaveBeenCalledWith({ timeMs: 250, y: 0.75 });
	});
});
