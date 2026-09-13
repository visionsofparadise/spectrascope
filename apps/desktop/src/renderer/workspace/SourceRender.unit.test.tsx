import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { SpectrogramCanvas, WaveformCanvas } from "spectral-display";
import { SourceRender } from "./SourceRender";
import { ComputeProgress } from "./spectral/ComputeProgress";
import { createDefaultSource } from "./source";
import { SPECTROGRAM_COLORMAPS } from "./utils/spectrogramColormaps";
import type { SourceRenderProps } from "./SourceRender";
import type { ComputeResult, ComputeResultReady, SpectralOptions } from "spectral-display";
import type { ReactElement } from "react";

const runtime = vi.hoisted(() => ({
	tiles: null as Array<{
		key: string;
		waveform: ComputeResultReady | null;
		spectrogram: ComputeResultReady | null;
	}> | null,
	index: 0,
	refs: [] as Array<{ current: unknown }>,
	held: null as ComputeResultReady | null,
	result: { status: "idle" } as ComputeResult,
	options: null as SpectralOptions | null,
	effects: [] as Array<() => unknown>,
}));

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	memo: (component: unknown) => component,
	useRef: (initial: unknown) => (runtime.refs[runtime.index++] ??= { current: initial }),
	useState: () => [
		runtime.held,
		(next: ComputeResultReady | null) => {
			runtime.held = next;
		},
	],
	useMemo: (compute: () => unknown) => compute(),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => unknown) => runtime.effects.push(effect),
}));
vi.mock("./spectral/useContainerSize", () => ({ useContainerSize: () => ({ width: 800, height: 400 }) }));
vi.mock("./spectral/useComputeSize", () => ({ useComputeSize: (size: unknown) => size }));
vi.mock("spectral-display", async (original) => ({
	...(await original<typeof import("spectral-display")>()),
	useDisplayCompute: (options: SpectralOptions) => {
		runtime.options = options;
		const result = runtime.result;
		const held =
			result.status === "ready"
				? result
				: result.status === "computing" || result.status === "error"
					? result.previous
					: null;
		return {
			...result,
			fraction: result.status === "computing" ? result.fraction : 1,
			tiles: runtime.tiles ?? (held ? [{ key: "tile", waveform: held, spectrogram: held }] : []),
		};
	},
	SpectrogramCanvas: () => null,
	WaveformCanvas: () => null,
}));

const props: SourceRenderProps = {
	source: createDefaultSource(0, { id: "source", name: "Example audio" }),
	audioData: {
		sampleRate: 48000,
		totalSamples: 48000,
		durationMs: 1000,
		channels: 1,
		readSamples: async () => new Float32Array(),
	},
	startMs: 0,
	endMs: 1000,
	spectrogramSampling: 4,
	fftSize: 2048,
	hopOverlap: 4,
	channelInput: "mono",
};

function ready(frequencyScale = "mel"): ComputeResultReady {
	return {
		status: "ready",
		query: { startMs: 0, endMs: 1000, width: 800, height: 400 },
		options: { metadata: { sampleRate: 48000 }, config: { frequencyScale } },
	} as ComputeResultReady;
}

function elements(node: unknown): Array<ReactElement<Record<string, unknown>>> {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, unknown>>(node)) return [];
	if (
		typeof node.type === "function" &&
		node.type !== SpectrogramCanvas &&
		node.type !== WaveformCanvas &&
		node.type !== ComputeProgress
	)
		return [node, ...elements((node.type as (props: unknown) => unknown)(node.props))];
	return [node, ...elements(node.props.children)];
}

function render(overrides: Partial<SourceRenderProps> = {}) {
	runtime.index = 0;
	return elements(SourceRender({ ...props, ...overrides }));
}

function progress() {
	return render().find((element) => element.type === ComputeProgress);
}

beforeEach(() => {
	runtime.tiles = null;
	runtime.index = 0;
	runtime.refs = [];
	runtime.held = null;
	runtime.result = { status: "idle" };
	runtime.options = null;
	runtime.effects = [];
});

describe("replacement analysis progress", () => {
	it("admits a throttled committed pan even when live scrolling already advanced", () => {
		render();
		render({ startMs: 100, endMs: 1100, liveStartMs: 120, liveEndMs: 1120, freezeCompute: true });
		expect(runtime.options?.query).toMatchObject({ startMs: 100, endMs: 1100 });
		const admitted = runtime.options;
		render({ startMs: 100, endMs: 1100, liveStartMs: 150, liveEndMs: 1150, freezeCompute: true, fftSize: 4096 });
		expect(runtime.options).toBe(admitted);
	});
	it("keeps waveform coverage while withholding stale frequency-scale spectral tiles", () => {
		const previous = ready("mel");
		const next = ready("linear");
		runtime.tiles = [
			{ key: "old", waveform: previous, spectrogram: previous },
			{ key: "new", waveform: next, spectrogram: next },
		];
		const onDisplayedResultChange = vi.fn();
		const tree = render({ frequencyScale: "linear", onDisplayedResultChange });
		for (const effect of runtime.effects) effect();
		expect(
			tree.filter((element) => element.type === SpectrogramCanvas).map((element) => element.props.computeResult),
		).toEqual([next]);
		expect(tree.filter((element) => element.type === WaveformCanvas)).toHaveLength(2);
		expect(onDisplayedResultChange).toHaveBeenCalledWith(
			props.source.id,
			expect.objectContaining({ results: [previous, next] }),
		);
		expect(onDisplayedResultChange.mock.lastCall?.[1]).not.toHaveProperty("spectrogramResults");
	});
	it("keeps waveform canvas identity across palette keys and overlapping tile reorder", () => {
		const first = ready();
		const second = ready();
		runtime.tiles = [
			{ key: "lava:first", waveform: first, spectrogram: first },
			{ key: "lava:second", waveform: second, spectrogram: null },
		];
		const before = render().filter((element) => element.props["data-display-layer"] === "waveform");
		runtime.tiles = [
			{ key: "viridis:second", waveform: second, spectrogram: null },
			{ key: "viridis:first", waveform: first, spectrogram: ready() },
		];
		const after = render({ spectrogramColormap: "viridis" }).filter(
			(element) => element.props["data-display-layer"] === "waveform",
		);
		expect(after.map((element) => element.key)).toEqual([before[1]?.key, before[0]?.key]);
	});
	it("adds placement once to waveform readouts while pointer time stays in timeline coordinates", () => {
		const placed = {
			...props.audioData,
			totalSamples: 96000,
			durationMs: 2000,
			timelinePlacement: { source: props.audioData, offsetSamples: 12000 },
		};
		const onDisplayedResultChange = vi.fn();
		const onCursorMove = vi.fn();
		runtime.held = ready();
		runtime.result = runtime.held;
		const tree = render({
			audioData: placed,
			startMs: 0,
			endMs: 2000,
			readoutTimeOffsetMs: 100,
			onDisplayedResultChange,
			onCursorMove,
		});
		for (const effect of runtime.effects) effect();
		expect(onDisplayedResultChange).toHaveBeenCalledWith(
			props.source.id,
			expect.objectContaining({ results: [runtime.held], timeOffsetMs: 350 }),
		);
		runtime.refs[0]!.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
		const move = tree[0]!.props.onMouseMove as (event: { clientX: number; clientY: number }) => void;
		move({ clientX: 50, clientY: 50 });
		expect(onCursorMove).toHaveBeenCalledWith(expect.objectContaining({ timeMs: 1100 }));
	});
	it("anchors placed audio analysis to the native reader and translates its held image", () => {
		const sourceAudio = props.audioData;
		const placed = {
			...sourceAudio,
			totalSamples: 96000,
			durationMs: 2000,
			readSamples: vi.fn(),
			timelinePlacement: { source: sourceAudio, offsetSamples: 12000 },
		};
		runtime.held = ready();
		runtime.result = runtime.held;
		const tree = render({ audioData: placed, startMs: 0, endMs: 2000 });
		expect(runtime.options?.readSamples).toBe(sourceAudio.readSamples);
		expect(runtime.options?.metadata.sampleCount).toBe(48000);
		expect(runtime.options?.query).toMatchObject({ startMs: -250, endMs: 1750 });
		expect(
			tree.some((element) => (JSON.stringify(element.props.style) ?? "").includes("translateX(12.5%) scaleX(0.5)")),
		).toBe(true);
	});
	it("finishes drawing a source even when the selected frequency crop is above its native Nyquist", () => {
		const incoming = ready("linear");
		runtime.result = incoming;
		const overrides = {
			displaySampleRate: 96000,
			frequencyScale: "linear" as const,
			frequencyRange: { top: 0, bottom: 0.25 },
		};
		const tree = render(overrides);
		const spectrum = tree.find((element) => element.type === SpectrogramCanvas)!;
		const container = tree.find((element) => element.props.children === spectrum);
		expect(container?.props.style).toMatchObject({ visibility: "hidden" });
		const waveform = tree.find((element) => element.type === WaveformCanvas)!;
		expect(waveform.props.computeResult).toBe(incoming);
		expect(waveform.props.onRendered).toBeUndefined();
		expect(render(overrides).some((element) => element.props.role === "progressbar")).toBe(false);
	});
	it("aligns native spectral pixels to a common display rate while keeping waveform crop independent", () => {
		runtime.result = ready("linear");
		const frequencyRange = { top: 0, bottom: 0.75 };
		const tree = render({ displaySampleRate: 96000, frequencyScale: "linear", frequencyRange });
		expect(runtime.options?.metadata.sampleRate).toBe(48000);
		const spectrum = tree.find((element) => element.type === SpectrogramCanvas);
		expect(spectrum?.props.frequencyRange).toEqual({ top: 0, bottom: 0.5 });
		const container = tree.find((element) => element.props.children === spectrum);
		const style = container?.props.style as { top: string; height: string };
		expect(Number.parseFloat(style.top)).toBeCloseTo(200 / 3);
		expect(Number.parseFloat(style.height)).toBeCloseTo(100 / 3);
		expect(tree.find((element) => element.type === WaveformCanvas)?.props.verticalRange).toBe(frequencyRange);
	});
	it("reports common-domain frequencies only within the native source bandwidth", () => {
		const onCursorMove = vi.fn();
		const tree = render({ displaySampleRate: 96000, frequencyScale: "linear", onCursorMove });
		runtime.refs[0]!.current = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
		const move = tree[0]!.props.onMouseMove as (event: { clientX: number; clientY: number }) => void;
		move({ clientX: 50, clientY: 75 });
		expect(onCursorMove).toHaveBeenLastCalledWith(expect.objectContaining({ frequencyHz: 12000, freq: "12.0 kHz" }));
		move({ clientX: 50, clientY: 25 });
		expect(onCursorMove).toHaveBeenLastCalledWith(expect.objectContaining({ frequencyHz: 0, freq: "—" }));
	});
	it.each(["lava", "viridis"] as const)(
		"uses the package %s palette independently of source colour",
		(spectrogramColormap) => {
			runtime.result = ready();
			const tree = render({ spectrogramColormap });
			expect(runtime.options?.config).toMatchObject({
				colormap: SPECTROGRAM_COLORMAPS[spectrogramColormap],
				spectrogram: true,
			});
			expect(tree.find((element) => element.type === WaveformCanvas)?.props.color).toEqual([140, 217, 205]);
		},
	);

	it("disables spectra and presents a waveform-only result immediately", () => {
		runtime.held = ready();
		const incoming = ready();
		runtime.result = incoming;
		const tree = render({ spectrogram: false });
		expect(tree[0]?.props.className).not.toContain("bg-void");
		expect(runtime.options?.config?.spectrogram).toBe(false);
		expect(tree.some((element) => element.type === SpectrogramCanvas)).toBe(false);
		expect(tree.find((element) => element.type === WaveformCanvas)?.props.computeResult).toBe(incoming);
		expect(render({ spectrogram: false }).some((element) => element.type === ComputeProgress)).toBe(false);
	});

	it("keeps held canvases visible while reporting source-specific progress without intercepting input", () => {
		const held = ready();
		runtime.held = held;
		runtime.result = { status: "computing", fraction: 0.42, previous: held };
		const tree = render();
		expect(tree.find((element) => element.type === ComputeProgress)?.props.fraction).toBe(0.42);
		expect(
			tree
				.filter((element) => element.type === SpectrogramCanvas || element.type === WaveformCanvas)
				.map((element) => element.props.computeResult),
		).toEqual([held, held]);
		expect(
			tree.some((element) => (element.props.style as { visibility?: string } | undefined)?.visibility === "hidden"),
		).toBe(false);
	});

	it("reports progress while computing and none for ready, failed and empty states", () => {
		runtime.result = { status: "computing", fraction: 0.2, previous: null };
		expect(progress()?.props.fraction).toBe(0.2);
		const held = ready();
		runtime.held = held;
		for (const result of [
			held,
			{ status: "error", error: new Error("failed"), previous: held },
			{ status: "idle" },
		] as Array<ComputeResult>) {
			runtime.result = result;
			expect(progress()).toBeUndefined();
		}
	});

	it("publishes waveform tiles while spectra are still pending", () => {
		const waveform = ready();
		runtime.result = { status: "computing", fraction: 0.5, previous: null };
		runtime.tiles = [{ key: "first", waveform, spectrogram: null }];
		const tree = render();
		expect(tree.find((element) => element.type === WaveformCanvas)?.props.computeResult).toBe(waveform);
		expect(tree.some((element) => element.type === SpectrogramCanvas)).toBe(false);
		expect(tree.find((element) => element.type === ComputeProgress)?.props.fraction).toBe(0.5);
	});

	it("keeps old spectral coverage below incoming spectra and every waveform above spectra", () => {
		const old = ready();
		const first = ready();
		const second = ready();
		runtime.tiles = [
			{ key: "old", waveform: old, spectrogram: old },
			{ key: "first", waveform: first, spectrogram: first },
			{ key: "second", waveform: second, spectrogram: null },
		];
		const canvases = render().filter(
			(element) => element.type === SpectrogramCanvas || element.type === WaveformCanvas,
		);
		expect(canvases.map((element) => element.props.computeResult)).toEqual([old, first, old, first, second]);
		expect(canvases.slice(2).every((element) => element.type === WaveformCanvas)).toBe(true);
	});
});
