const MAX_BATCH_SAMPLES = 131072;

export class StratifiedSpectrogramSampler {
	private readonly tail: Float32Array;
	private tailLength = 0;
	private readonly winner: Float32Array;
	private readonly batch: Float32Array;
	private batchLength = 0;
	private position = 0;
	private stratum = 0;
	private candidateStart = 0;
	private winnerStart = -1;
	private winnerEnergy = -Infinity;

	constructor(
		private readonly sampleCount: number,
		private readonly stratumCount: number,
		private readonly fftSize: number,
		private readonly candidateHop: number,
		private readonly submit: (samples: Float32Array, count: number) => void,
	) {
		this.tail = new Float32Array(fftSize - 1);
		this.winner = new Float32Array(fftSize);
		this.batch = new Float32Array(Math.max(fftSize, Math.floor(MAX_BATCH_SAMPLES / fftSize) * fftSize));
	}

	consume(samples: Float32Array, count: number): void {
		const combinedStart = this.position - this.tailLength;
		const combined = new Float32Array(this.tailLength + count);

		combined.set(this.tail.subarray(0, this.tailLength));
		combined.set(samples.subarray(0, count), this.tailLength);

		const energy = new Float64Array(combined.length);
		let energyStratum = Math.floor((combinedStart * this.stratumCount) / this.sampleCount);
		let nextBoundary = Math.floor(((energyStratum + 1) * this.sampleCount) / this.stratumCount);
		let sum = 0;

		for (let index = 0; index < combined.length; index++) {
			if (combinedStart + index >= nextBoundary) {
				energyStratum++;
				nextBoundary = Math.floor(((energyStratum + 1) * this.sampleCount) / this.stratumCount);
				sum = 0;
			}

			const sample = combined[index]!;

			sum += sample * sample;
			energy[index] = sum;
		}

		this.position += count;

		while (this.stratum < this.stratumCount && this.candidateStart + this.fftSize <= this.position) {
			const stratumEnd = Math.floor(((this.stratum + 1) * this.sampleCount) / this.stratumCount);
			const finalStart = stratumEnd - this.fftSize;
			const relativeStart = this.candidateStart - combinedStart;
			const stratumStart = Math.floor((this.stratum * this.sampleCount) / this.stratumCount);
			const before = relativeStart > 0 && this.candidateStart > stratumStart ? energy[relativeStart - 1]! : 0;
			const candidateEnergy = energy[relativeStart + this.fftSize - 1]! - before;

			if (this.winnerStart < 0 || candidateEnergy > this.winnerEnergy) {
				this.winnerEnergy = candidateEnergy;
				this.winnerStart = this.candidateStart;
			}

			if (this.candidateStart === finalStart) {
				this.retainWinner(combined, combinedStart);
				this.batch.set(this.winner, this.batchLength);
				this.batchLength += this.fftSize;

				if (this.batchLength === this.batch.length) this.flush();

				this.stratum++;
				this.candidateStart = Math.floor((this.stratum * this.sampleCount) / this.stratumCount);
				this.winnerStart = -1;
				this.winnerEnergy = -Infinity;
			} else {
				this.candidateStart = Math.min(finalStart, this.candidateStart + this.candidateHop);
			}
		}

		this.retainWinner(combined, combinedStart);
		this.tailLength = Math.min(this.tail.length, combined.length);
		this.tail.set(combined.subarray(combined.length - this.tailLength));
	}

	finish(): void {
		if (this.position !== this.sampleCount || this.stratum !== this.stratumCount) {
			throw new Error("Spectrogram sampling ended before all strata were scanned");
		}

		this.flush();
	}

	private retainWinner(combined: Float32Array, combinedStart: number): void {
		if (this.winnerStart < combinedStart || this.winnerStart < 0) return;

		const offset = this.winnerStart - combinedStart;

		this.winner.set(combined.subarray(offset, offset + this.fftSize));
	}

	private flush(): void {
		if (this.batchLength === 0) return;

		this.submit(this.batch, this.batchLength);
		this.batchLength = 0;
	}
}
