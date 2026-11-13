import { spectrum } from './spectrum';

/** Onsets: how much new sound starts, every few ms (an envelope, in the recording's time) */
export type Onset = { positionMs: number; value: number };

/** Samples analysed at once, and how far apart (about 46 ms and 11.6 ms at 22050 Hz) */
const ONSET_SIZE = 1024;
const ONSET_HOP = 256;

/**
 * Finds onsets in a stream of samples: how much each frequency got louder since the last
 * analysis (spectral flux, on a log scale)
 */
export class OnsetDetector {
  private buffer = new Float32Array(0);

  private previous: Float32Array | null = null;

  /** Samples come with the time (ms) of the last one: the onsets found, with their time */
  push(samples: Float32Array, lastAtMs: number, rate: number): Onset[] {
    const next = new Float32Array(this.buffer.length + samples.length);
    next.set(this.buffer);
    next.set(samples, this.buffer.length);
    const found: Onset[] = [];
    let start = 0;
    for (; start + ONSET_SIZE <= next.length; start += ONSET_HOP) {
      const levels = spectrum(next.subarray(start, start + ONSET_SIZE));
      const logs = levels.map((v) => Math.log1p(1000 * v));
      let flux = 0;
      if (this.previous) {
        for (let bin = 2; bin < logs.length; bin += 1) {
          const rise = logs[bin] - this.previous[bin];
          if (rise > 0) flux += rise;
        }
      }
      this.previous = logs;
      // the middle of the samples analysed
      const middle = start + ONSET_SIZE / 2;
      found.push({
        positionMs: lastAtMs - ((next.length - middle) / rate) * 1000,
        value: flux,
      });
    }
    this.buffer = next.slice(start);
    return found;
  }
}

/** The onsets of a whole recording (to test) */
export function onsetsOfSamples(samples: Float32Array, rate: number, startMs = 0): Onset[] {
  const detector = new OnsetDetector();
  return detector.push(samples, startMs + (samples.length / rate) * 1000, rate);
}
