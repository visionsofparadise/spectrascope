export const FREQUENCY_TICK_LABELS: ReadonlyArray<{ hz: number; label: string }> = [
	{ hz: 20, label: "20" },
	{ hz: 50, label: "50" },
	{ hz: 100, label: "100" },
	{ hz: 200, label: "200" },
	{ hz: 500, label: "500" },
	{ hz: 1000, label: "1k" },
	{ hz: 2000, label: "2k" },
	{ hz: 5000, label: "5k" },
	{ hz: 10000, label: "10k" },
	{ hz: 20000, label: "20k" },
];

export function majorTickIntervalMs(spanMs: number): number {
	if (spanMs < 2000) return 200;

	if (spanMs < 5000) return 500;

	if (spanMs < 10000) return 1000;

	if (spanMs < 30000) return 2000;

	if (spanMs < 60000) return 5000;

	return 10000;
}
