import { Note } from 'tonal';

import { SongPart } from 'main/types';

import { getChordVoicing } from './fingering';

/**
 * Syncing by listening: the sound of the song (a sound input, like the monitor of the speakers
 * or a microphone) is turned into how much of each note is heard (chroma), and compared with
 * the chords and notes of the song to find where the song is in the recording
 */

/** The notes heard (12 pitch classes) at a moment */
export type ChromaFrame = {
  /** when it was heard (performance.now()) */
  at: number;
  chroma: Float32Array;
};

/** How often the sound is read (ms) */
const FRAME_MS = 50;
const FFT_SIZE = 8192;
/** the sound of the computer: its rate, and the samples analysed at once */
const CAPTURE_RATE = 22050;
const CAPTURE_FFT = 4096;
/** Frequencies read (Hz): low notes are too close together for the analysis */
const MIN_HZ = 100;
const MAX_HZ = 2500;
/** Quieter than this (average level of the bins, linear): silence */
const SILENCE = 1e-4;

/** The input that is the sound played by the computer (the default) */
export const COMPUTER_SOUND = 'computer';

/** Sound inputs, with their names (asked once for them to be named) */
export async function getSoundInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Sound input ${index + 1}`,
    }));
}

const constraints = (deviceId: string): MediaStreamConstraints => ({
  audio: {
    ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
});

/**
 * How much of each note is in a spectrum (levels of frequency bins, linear), or null when
 * it is silence
 */
function toChroma(level: (bin: number) => number, binHz: number, bins: number) {
  const first = Math.ceil(MIN_HZ / binHz);
  const last = Math.min(bins - 1, Math.floor(MAX_HZ / binHz));
  const chroma = new Float32Array(12);
  let total = 0;
  for (let bin = first; bin <= last; bin += 1) {
    const midi = 69 + 12 * Math.log2((bin * binHz) / 440);
    const value = level(bin);
    chroma[((Math.round(midi) % 12) + 12) % 12] += value;
    total += value;
  }
  if (total / (last - first + 1) < SILENCE) return null;
  const max = Math.max(...chroma);
  // compressed: loud notes do not hide the others
  return chroma.map((value) => Math.log1p((20 * value) / max));
}

/** Levels of the frequencies of samples (a Hann window, then a fast Fourier transform) */
/* eslint-disable no-bitwise */
function spectrum(samples: Float32Array) {
  const n = samples.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i += 1) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  // bit reversal
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + size / 2;
        const tre = re[b] * cos - im[b] * sin;
        const tim = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tre;
        im[b] = im[a] - tim;
        re[a] += tre;
        im[a] += tim;
      }
    }
  }
  const levels = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) levels[i] = Math.hypot(re[i], im[i]) / n;
  return levels;
}
/* eslint-enable no-bitwise */

/** The notes heard in samples of the sound of the computer (null: silence) */
export function chromaOfSamples(samples: Float32Array, rate = CAPTURE_RATE) {
  const levels = spectrum(samples);
  return toChroma((bin) => levels[bin], rate / samples.length, levels.length);
}

/**
 * Listens to the sound of the computer or a sound input, and keeps the notes heard
 */
export class SongListener {
  frames: ChromaFrame[] = [];

  /** what is listened to */
  label = '';

  private stopping: (() => void)[] = [];

  /** Listens to an input, or to the sound of the computer (a microphone when it cannot) */
  async start(input = COMPUTER_SOUND) {
    this.stop();
    if (!input || input === COMPUTER_SOUND) {
      try {
        await this.startComputerSound();
        return;
      } catch (e) {
        this.stop();
        // the default input (a microphone hears the speakers too)
        await this.startInput('default');
        this.label += ' (the sound of the computer could not be heard)';
        return;
      }
    }
    await this.startInput(input);
  }

  /** The sound of the computer, from the main process */
  private async startComputerSound() {
    let buffer = new Float32Array(0);
    // samples analysed so far, and how many came before the buffer
    let analysed = 0;
    let dropped = 0;
    const hop = Math.round((CAPTURE_RATE * FRAME_MS) / 1000);
    const unsubscribe = window.app.sound.onData((samples: Float32Array, at: number) => {
      // when the last sample was heard, on this page's clock
      const lastAt = performance.now() - (Date.now() - at);
      const next = new Float32Array(buffer.length + samples.length);
      next.set(buffer);
      next.set(samples, buffer.length);
      buffer = next;
      const total = dropped + buffer.length;
      while (analysed + hop + CAPTURE_FFT <= total) {
        analysed += hop;
        const from = analysed - dropped;
        const chroma = chromaOfSamples(buffer.subarray(from, from + CAPTURE_FFT));
        // the middle of the samples analysed
        const middle = analysed + CAPTURE_FFT / 2;
        if (chroma) {
          this.frames.push({ at: lastAt - ((total - middle) / CAPTURE_RATE) * 1000, chroma });
        }
      }
      // only the samples still needed are kept
      const keep = Math.max(0, analysed - dropped);
      buffer = buffer.slice(keep);
      dropped += keep;
    });
    this.stopping.push(() => {
      unsubscribe();
      window.app.sound.stop().catch(() => {});
    });
    const tool = await window.app.sound.start();
    this.label = `the sound of the computer (${tool})`;
  }

  /** A sound input (a microphone, a sound card input...) */
  private async startInput(deviceId: string) {
    const stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
    const track = stream.getAudioTracks()[0];
    this.label = track?.label ?? 'a sound input';
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    context.createMediaStreamSource(stream).connect(analyser);

    const bins = new Float32Array(analyser.frequencyBinCount);
    const binHz = context.sampleRate / FFT_SIZE;
    // the analysis looks at the last FFT_SIZE samples: it is about half of them late,
    // plus how late the input is
    const inputLatency = (track?.getSettings() as { latency?: number })?.latency ?? 0;
    const lateMs = (FFT_SIZE / 2 / context.sampleRate + inputLatency) * 1000;

    const timer = setInterval(() => {
      analyser.getFloatFrequencyData(bins);
      const chroma = toChroma((bin) => 10 ** (bins[bin] / 20), binHz, bins.length);
      if (chroma) this.frames.push({ at: performance.now() - lateMs, chroma });
    }, FRAME_MS);
    this.stopping.push(() => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      context.close().catch(() => {});
    });
  }

  stop() {
    this.stopping.forEach((stop) => stop());
    this.stopping = [];
  }
}

/** The notes expected in a song, every quarter of a beat (from the start of its intro) */
export type SongTemplate = { step: number; vectors: (Float32Array | null)[] };

const STEP = 0.25;

/**
 * The notes of a song through time: its chords (and the notes of its parts when it has some)
 */
export function buildSongTemplate(
  chords: { chord: { tonic: string | null; intervals: string[] }; beats?: number }[],
  beatsPerBar: number,
  leadIn: number,
  parts: SongPart[] = []
): SongTemplate {
  const totalBeats =
    leadIn + chords.reduce((sum, chord) => sum + (chord.beats ?? beatsPerBar), 0) + beatsPerBar;
  const vectors: (Float32Array | null)[] = Array.from(
    { length: Math.ceil(totalBeats / STEP) },
    () => null
  );
  const add = (fromBeat: number, toBeat: number, chroma: number, weight: number) => {
    for (let i = Math.floor(fromBeat / STEP); i < Math.ceil(toBeat / STEP); i += 1) {
      if (i >= 0 && i < vectors.length) {
        vectors[i] = vectors[i] ?? new Float32Array(12);
        (vectors[i] as Float32Array)[chroma] += weight;
      }
    }
  };

  let position = leadIn;
  chords.forEach(({ chord, beats = beatsPerBar }) => {
    const root = Note.chroma(chord.tonic ?? 'C') ?? 0;
    getChordVoicing(chord.intervals).forEach((semitones) =>
      add(position, position + beats, (root + semitones) % 12, semitones === 0 ? 1.5 : 1)
    );
    position += beats;
  });
  parts.forEach((part) => {
    for (let i = 0; i + 3 < part.notes.length; i += 4) {
      const [start, length, midi, velocity] = part.notes.slice(i, i + 4);
      add(start, start + Math.max(STEP, length), ((midi % 12) + 12) % 12, (0.7 * velocity) / 127);
    }
  });
  return { step: STEP, vectors };
}

/** A vector moved around 0 and of length 1 (to compare shapes, not loudness) */
function centered(vector: Float32Array) {
  const mean = vector.reduce((sum, v) => sum + v, 0) / vector.length;
  const result = vector.map((v) => v - mean);
  const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
  return norm > 1e-6 ? result.map((v) => v / norm) : null;
}

/** Where a sound was heard in the recording (ms) */
export type HeardFrame = { positionMs: number; chroma: Float32Array };

/** How far apart the guesses are (ms) */
const SEARCH_STEP_MS = 20;
/** Guesses this close to the best one are as good: the nearest to the current sync is kept */
const ALMOST_BEST = 0.92;
/** The sounds heard must look like the song at least this much (average correlation) */
const MIN_MATCH = 0.12;

/**
 * Where the first chord is in the recording (ms): the place, near the current guess, where
 * what was heard looks most like the song. Null when nothing looks like it enough.
 */
export function findFirstChordMs(
  heard: HeardFrame[],
  template: SongTemplate,
  beatMs: number,
  leadIn: number,
  guessMs: number,
  rangeMs: number
): { firstChordMs: number; match: number } | null {
  const frames = heard
    .map((frame) => ({ positionMs: frame.positionMs, chroma: centered(frame.chroma) }))
    .filter((frame): frame is { positionMs: number; chroma: Float32Array } => !!frame.chroma);
  const expected = template.vectors.map((vector) => (vector ? centered(vector) : null));
  if (frames.length < 20) return null;

  const scores: { firstChordMs: number; score: number; count: number }[] = [];
  for (let offset = -rangeMs; offset <= rangeMs; offset += SEARCH_STEP_MS) {
    const firstChordMs = guessMs + offset;
    let score = 0;
    let count = 0;
    frames.forEach((frame) => {
      const beat = leadIn + (frame.positionMs - firstChordMs) / beatMs;
      const vector = expected[Math.floor(beat / template.step)];
      if (beat < 0 || !vector) return;
      let dot = 0;
      for (let pc = 0; pc < 12; pc += 1) dot += vector[pc] * frame.chroma[pc];
      score += dot;
      count += 1;
    });
    scores.push({ firstChordMs, score, count });
  }

  const best = Math.max(...scores.map((s) => s.score));
  if (best <= 0) return null;
  // peaks almost as good as the best one (a repeated part of the song looks the same):
  // the nearest to the guess
  // (a peak is the best guess within a beat around it)
  const around = Math.max(1, Math.round(beatMs / SEARCH_STEP_MS));
  const peaks = scores.filter(
    (s, i) =>
      s.score >= best * ALMOST_BEST &&
      scores.slice(Math.max(0, i - around), i + around + 1).every((other) => other.score <= s.score)
  );
  const chosen = peaks.sort(
    (a, b) => Math.abs(a.firstChordMs - guessMs) - Math.abs(b.firstChordMs - guessMs)
  )[0];
  const match = chosen.count ? chosen.score / chosen.count : 0;
  if (match < MIN_MATCH) return null;
  return { firstChordMs: chosen.firstChordMs, match };
}
