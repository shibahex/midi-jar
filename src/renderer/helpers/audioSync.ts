import { Note } from 'tonal';

import { SongPart } from 'main/types';
import { OnsetDetector, Onset } from './onsets';
import { spectrum } from './spectrum';

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
/** The sound of the computer quieter than this (RMS of the samples, about -74 dB): silence */
const SILENT_SAMPLES = 2e-4;

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
function toChroma(level: (bin: number) => number, binHz: number, bins: number, silence = SILENCE) {
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
  if (total / (last - first + 1) < silence) return null;
  const max = Math.max(...chroma);
  // compressed: loud notes do not hide the others
  return chroma.map((value) => Math.log1p((20 * value) / max));
}

/** The notes heard in samples of the sound of the computer (null: silence) */
export function chromaOfSamples(samples: Float32Array, rate = CAPTURE_RATE) {
  // silence is told by the samples: quiet music spreads thin over the bins of the spectrum
  const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  if (rms < SILENT_SAMPLES) return null;
  const levels = spectrum(samples);
  return toChroma((bin) => levels[bin], rate / samples.length, levels.length, 0);
}

/** Recording tools that hear the song alone (not the game's sound): what is heard */
const ISOLATED_TOOLS: Record<string, string> = {
  'Spotify only': 'Spotify alone',
  'Browser only': 'the browser alone',
};

/**
 * Listens to the sound of the computer or a sound input, and keeps the notes heard
 */
export class SongListener {
  frames: ChromaFrame[] = [];

  /** what is listened to */
  label = '';

  /**
   * Spotify or the browser alone is heard (not the game's own sound): it can be listened to all
   * along
   */
  isolated = false;

  /** the onsets heard (the sound of the computer only), at their time on this page's clock */
  onsets: Onset[] = [];

  /** every onset is kept (to hear a whole song), not only the last half minute */
  keepOnsets = false;

  private stopping: (() => void)[] = [];

  /**
   * Listens to an input, or to the sound of the computer (a microphone when it cannot). The
   * song's link: a YouTube video is heard in the browser alone.
   */
  async start(input?: string, uri?: string) {
    this.stop();
    if (!input || input === COMPUTER_SOUND) {
      try {
        await this.startComputerSound(uri);
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

  /**
   * Analyses samples of the sound of the computer (at CAPTURE_RATE), given with the time the
   * last one was heard (ms since 1970)
   */
  private sampleAnalyser() {
    let buffer = new Float32Array(0);
    // samples analysed so far, and how many came before the buffer
    let analysed = 0;
    let dropped = 0;
    const hop = Math.round((CAPTURE_RATE * FRAME_MS) / 1000);
    const detector = new OnsetDetector();
    // the samples come in bunches, some later than others: the time of a sample is told by
    // how many came before it, from the bunches that came soonest lately
    let received = 0;
    const soonest: number[] = [];
    return (samples: Float32Array, at: number) => {
      received += samples.length;
      const receivedMs = (received / CAPTURE_RATE) * 1000;
      soonest.push(performance.now() - (Date.now() - at) - receivedMs);
      if (soonest.length > 100) soonest.shift();
      // when the last sample was heard, on this page's clock
      const lastAt = Math.min(...soonest) + receivedMs;
      this.onsets.push(...detector.push(samples, lastAt, CAPTURE_RATE));
      // (the last half minute is enough)
      if (!this.keepOnsets && this.onsets.length > 4000) {
        this.onsets.splice(0, this.onsets.length - 2600);
      }
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
    };
  }

  /** The sound of the computer, from the main process (Windows: heard by this page) */
  private async startComputerSound(uri?: string) {
    if (window.os?.isWindows) {
      await this.startLoopback();
      return;
    }
    const unsubscribe = window.app.sound.onData(this.sampleAnalyser());
    this.stopping.push(() => {
      unsubscribe();
      window.app.sound.stop().catch(() => {});
    });
    const tool = await window.app.sound.start(uri);
    const alone = ISOLATED_TOOLS[tool];
    this.isolated = !!alone;
    this.label = alone ?? `the sound of the computer (${tool})`;
  }

  /**
   * Windows: the sound of the computer, asked as the sound of a capture of the screen (the main
   * process gives it: "loopback"). The game's own sound is heard too.
   */
  private async startLoopback() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    // (only the sound is used)
    stream.getVideoTracks().forEach((track) => track.stop());
    if (!stream.getAudioTracks().length) throw new Error('No sound of the computer');
    const context = new AudioContext({ sampleRate: CAPTURE_RATE });
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 2, 1);
    const analyse = this.sampleAnalyser();
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer;
      const left = input.getChannelData(0);
      const right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
      const samples = new Float32Array(left.length);
      for (let i = 0; i < samples.length; i += 1) samples[i] = (left[i] + right[i]) / 2;
      analyse(samples, Date.now());
    };
    source.connect(processor);
    // (a processor only runs when it goes somewhere: silence)
    const silent = context.createGain();
    silent.gain.value = 0;
    processor.connect(silent).connect(context.destination);
    this.stopping.push(() => {
      processor.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      context.close().catch(() => {});
    });
    this.isolated = false;
    this.label = 'the sound of the computer';
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
export function centered(vector: Float32Array) {
  const mean = vector.reduce((sum, v) => sum + v, 0) / vector.length;
  const result = vector.map((v) => v - mean);
  const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
  return norm > 1e-6 ? result.map((v) => v / norm) : null;
}

/** The song's notes, each moved around 0 (kept: they are compared many times a second) */
const centeredTemplates = new WeakMap<SongTemplate, (Float32Array | null)[]>();
export function centeredTemplate(template: SongTemplate) {
  let vectors = centeredTemplates.get(template);
  if (!vectors) {
    vectors = template.vectors.map((vector) => (vector ? centered(vector) : null));
    centeredTemplates.set(template, vectors);
  }
  return vectors;
}

/** Where a sound was heard in the recording (ms) */
export type HeardFrame = { positionMs: number; chroma: Float32Array };

/** A sound moved by semitones (what is heard a semitone higher reads as the song's note) */
export function transposed(chroma: Float32Array, semitones: number) {
  if (!semitones) return chroma;
  return chroma.map((_, pc) => chroma[(((pc + semitones) % 12) + 12) % 12]);
}

/** The pitch classes of a song (or of what was heard) all together, centered */
function profile(vectors: (Float32Array | null)[]) {
  const sum = new Float32Array(12);
  vectors.forEach((vector) => {
    const total = vector?.reduce((a, v) => a + v, 0) ?? 0;
    if (!vector || total <= 0) return;
    vector.forEach((v, pc) => {
      sum[pc] += v / total;
    });
  });
  return centered(sum);
}

/**
 * How much higher the recording sounds than the song must be clear: its notes look like the
 * song's at least this much, and this much more than unmoved
 */
const KEY_MATCH = 0.5;
const KEY_BETTER = 0.15;

/**
 * The key of what was heard, compared with the song's: how many semitones higher it sounds
 * (0 when in the same key or when it is not clear), and how much its notes look like the
 * song's (-1 to 1: below about 0.3, it does not sound like the song)
 */
export function findKeyShift(heard: HeardFrame[], template: SongTemplate) {
  const song = profile(template.vectors);
  const heardProfile = profile(heard.map((frame) => frame.chroma));
  if (!song || !heardProfile) return { semitones: 0, match: 0 };
  const matches = Array.from({ length: 12 }, (_, semitones) => {
    const moved = transposed(heardProfile, semitones);
    return song.reduce((sum, v, pc) => sum + v * moved[pc], 0);
  });
  const best = matches.indexOf(Math.max(...matches));
  const clear = matches[best] >= KEY_MATCH && matches[best] - matches[0] >= KEY_BETTER;
  const semitones = clear ? best : 0;
  // -5 to +6: the nearest way to say it
  return { semitones: semitones > 6 ? semitones - 12 : semitones, match: matches[semitones] };
}
