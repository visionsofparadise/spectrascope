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
	index: 0,
	refs: [] as Array<{ current: unknown }>,
	held: null as ComputeResultReady | null,
	result: { status: "idle" } as ComputeResult,
	options: null as SpectralOptions | null,
}));

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: (initial: unknown) => (runtime.refs[runtime.index++] ??= { current: initial }),
	useState: () => [
		runtime.held,
		(next: ComputeResultReady | null) => {
			runtime.held = next;
		},
	],
	useMemo: (compute: () => unknown) => compute(),
	useCallback: (callback: unknown) => callback,
	useEffect: () => undefined,
}));
vi.mock("./spectral/useContainerSize", () => ({ useContainerSize: () => ({ width: 800, height: 400 }) }));
vi.mock("spectral-display", async (original) => ({
	...(await original<typeof import("spectral-display")>()),
	useSpectralCompute: (options: SpectralOptions) => {
		runtime.options = options;
		return runtime.result;
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

function ready(): ComputeResultReady {
	return {
		status: "ready",
		query: { startMs: 0, endMs: 1000, width: 800, height: 400 },
		options: { config: { frequencyScale: "mel" } },
	} as ComputeResultReady;
}

function elements(node: unknown): Array<ReactElement<Record<string, unknown>>> {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement<Record<string, unknown>>(node)) return [];
	return [node, ...elements(node.props.children)];
}

function render(overrides: Partial<SourceRenderProps> = {}) {
	runtime.index = 0;
	return elements(SourceRender({ ...props, ...overrides }));
}

function progress() {
	return render().find((element) => element.props.role === "progressbar");
}

beforeEach(() => {
	runtime.index = 0;
	runtime.refs = [];
	runtime.held = null;
	runtime.result = { status: "idle" };
	runtime.options = null;
});

describe("replacement analysis progress", () => {
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

	it("disables spectra and completes a waveform-only replacement after one draw", () => {
		runtime.held = ready();
		const incoming = ready();
		runtime.result = incoming;
		const tree = render({ spectrogram: false });
		expect(tree[0]?.props.className).not.toContain("bg-void");
		expect(runtime.options?.config?.spectrogram).toBe(false);
		expect(tree.some((element) => element.type === SpectrogramCanvas)).toBe(false);
		const draw = tree.find((element) => element.type === WaveformCanvas && element.props.onRendered)?.props
			.onRendered as () => void;
		draw();
		expect(runtime.held).toBe(incoming);
		expect(render({ spectrogram: false }).some((element) => element.props.role === "progressbar")).toBe(false);
	});

	it("keeps held canvases visible while reporting source-specific progress without intercepting input", () => {
		const held = ready();
		runtime.held = held;
		runtime.result = { status: "computing", fraction: 0.42, previous: held };
		const tree = render();
		const indicator = tree.find((element) => element.props.role === "progressbar");
		expect(indicator?.props).toMatchObject({
			"aria-label": "Updating analysis for Example audio",
			"aria-valuenow": 42,
		});
		expect(indicator?.props.className).toContain("pointer-events-none");
		expect(
			tree
				.filter((element) => element.type === SpectrogramCanvas || element.type === WaveformCanvas)
				.map((element) => element.props.computeResult),
		).toEqual([held, held]);
		expect(tree.some((element) => element.type === ComputeProgress)).toBe(false);
		expect(
			tree.some((element) => (element.props.style as { visibility?: string } | undefined)?.visibility === "hidden"),
		).toBe(false);
	});

	it("preserves initial loading and hides replacement progress for ready, failed and empty states", () => {
		runtime.result = { status: "computing", fraction: 0.2, previous: null };
		expect(render().some((element) => element.type === ComputeProgress)).toBe(true);
		expect(progress()).toBeUndefined();
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

	it("shows final rendering progress until both replacement layers have drawn", () => {
		runtime.held = ready();
		const incoming = ready();
		runtime.result = incoming;
		const tree = render();
		expect(progress()?.props).toMatchObject({ "aria-valuenow": 100, "aria-valuetext": "Rendering updated view" });
		const draw = tree.find((element) => element.type === SpectrogramCanvas && element.props.onRendered)?.props
			.onRendered as () => void;
		draw();
		expect(progress()).toBeDefined();
		draw();
		expect(runtime.held).toBe(incoming);
		expect(progress()).toBeUndefined();
	});

	it.each([
		[-1, 0],
		[1.5, 100],
		[NaN, 0],
	])("bounds progress %s to an accessible percentage", (fraction, expected) => {
		runtime.held = ready();
		runtime.result = { status: "computing", fraction, previous: runtime.held };
		expect(progress()?.props["aria-valuenow"]).toBe(expected);
	});
});
