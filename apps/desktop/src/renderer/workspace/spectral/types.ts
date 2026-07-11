export interface AudioData {
  sampleRate: number;
  channels: number;
  totalSamples: number;
  durationMs: number;
  readSamples: (channel: number, sampleOffset: number, sampleCount: number) => Promise<Float32Array>;
}
