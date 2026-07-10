import type { RenderSpec } from "./renderSpec";

/** The common sample rate every input is resampled to before mixing. */
const MIX_SAMPLE_RATE = 48_000;

/**
 * Builds the per-input pre-processing chain: resample to a common rate, force a
 * common float/stereo layout, then delay by the source's timeline offset so the
 * mix is aligned. `adelay` takes a per-channel delay list; stereo needs two.
 */
const buildInputChain = (index: number, offsetMs: number): string => {
	const delay = Math.max(0, Math.round(offsetMs));

	return (
		`[${index}:a]aresample=${MIX_SAMPLE_RATE},` +
		`aformat=sample_fmts=fltp:channel_layouts=stereo,` +
		`adelay=${delay}|${delay}[d${index}]`
	);
};

/**
 * Builds the complete ffmpeg argv (inputs, `-filter_complex`, output) for a Sum
 * or Difference render.
 *
 * Sum is `amix` of every input with `normalize=0` — without it amix divides by
 * the input count and attenuates the mix. Difference is the reference input
 * minus the rest: every non-reference input is polarity-inverted (`volume=-1.0`)
 * and then `amix`ed with the reference, again `normalize=0`. Output is a
 * `pcm_f32le` WAV: lossless into the spectral decode path and unable to clip an
 * un-normalized sum.
 */
export const buildFfmpegArgs = (spec: RenderSpec, outputPath: string): Array<string> => {
	const { operation, inputs, referenceIndex } = spec;

	if (inputs.length === 0) {
		throw new Error("Cannot build a filtergraph with no inputs");
	}

	if (operation === "difference" && inputs.length < 2) {
		throw new Error("A difference render requires at least two inputs");
	}

	if (operation === "difference" && (referenceIndex < 0 || referenceIndex >= inputs.length)) {
		throw new Error(`referenceIndex ${referenceIndex} is out of range for ${inputs.length} inputs`);
	}

	const inputArgs = inputs.flatMap((input) => ["-i", input.filePath]);

	const inputChains = inputs.map((input, index) => buildInputChain(index, input.offsetMs));

	const filterParts: Array<string> = [...inputChains];
	const mixLabels: Array<string> = [];

	if (operation === "sum") {
		for (let index = 0; index < inputs.length; index++) {
			mixLabels.push(`[d${index}]`);
		}
	} else {
		for (let index = 0; index < inputs.length; index++) {
			if (index === referenceIndex) {
				mixLabels.push(`[d${index}]`);
			} else {
				filterParts.push(`[d${index}]volume=-1.0[n${index}]`);
				mixLabels.push(`[n${index}]`);
			}
		}
	}

	filterParts.push(
		`${mixLabels.join("")}amix=inputs=${inputs.length}:duration=longest:normalize=0:dropout_transition=0[out]`,
	);

	const filterComplex = filterParts.join(";");

	return [
		"-y",
		"-hide_banner",
		"-nostdin",
		...inputArgs,
		"-filter_complex",
		filterComplex,
		"-map",
		"[out]",
		"-c:a",
		"pcm_f32le",
		"-f",
		"wav",
		outputPath,
	];
};
