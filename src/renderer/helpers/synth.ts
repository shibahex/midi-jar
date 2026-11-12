/**
 * A small built-in sound (Web Audio): a soft electric-piano-like tone for notes and chords,
 * and a click for the beat. No samples: a few oscillators with a decaying envelope.
 */

type Voice = { gain: GainNode; oscillators: OscillatorNode[] };

/** Sounds: soft keys (chords, rhythm guitar), bass, lead guitar, voice (melody) */
export type Instrument = 'keys' | 'bass' | 'lead' | 'voice';

type Tone = {
  partials: [OscillatorType, number, number][];
  level: number;
  attack: number;
  /** level kept while the note is held (1: no fade) */
  sustain: number;
  /** brightness: lowpass frequency as a multiple of the note frequency */
  brightness: number;
  maxCutoff: number;
  vibrato?: number;
};

const TONES: Record<Instrument, Tone> = {
  keys: {
    partials: [
      ['triangle', 1, 1],
      ['sine', 2, 0.35],
      ['sine', 3, 0.12],
    ],
    level: 0.22,
    attack: 0.006,
    sustain: 0.05,
    brightness: 8,
    maxCutoff: 9000,
  },
  bass: {
    partials: [
      ['sine', 1, 1],
      ['triangle', 2, 0.25],
    ],
    level: 0.32,
    attack: 0.005,
    sustain: 0.35,
    brightness: 6,
    maxCutoff: 1400,
  },
  lead: {
    partials: [
      ['sawtooth', 1, 0.6],
      ['square', 1.003, 0.25],
    ],
    level: 0.12,
    attack: 0.01,
    sustain: 0.6,
    brightness: 5,
    maxCutoff: 4000,
    vibrato: 4,
  },
  voice: {
    partials: [
      ['triangle', 1, 1],
      ['sine', 2, 0.2],
    ],
    level: 0.2,
    attack: 0.04,
    sustain: 0.8,
    brightness: 4,
    maxCutoff: 3500,
    vibrato: 6,
  },
};

const midiToFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** time for a note to fade out once released, in seconds */
const RELEASE = 0.25;

class Synth {
  private context: AudioContext | null = null;

  private master: GainNode | null = null;

  private volume = 0.7;

  /** notes held from a keyboard (one voice per key) */
  private held = new Map<number, Voice>();

  /** keys released while the sustain pedal is down */
  private sustained = new Set<number>();

  private pedal = false;

  /** The audio output, created on first use (browsers start it after a user action) */
  private output() {
    if (!this.context) {
      this.context = new AudioContext();
      const compressor = this.context.createDynamicsCompressor();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    return { context: this.context, master: this.master as GainNode };
  }

  /** Volume from 0 to 1 */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** A note starting at `when` (audio time) with a sound */
  private voice(
    midi: number,
    velocity: number,
    when: number,
    instrument: Instrument = 'keys'
  ): Voice {
    const { context, master } = this.output();
    const tone = TONES[instrument];
    const frequency = midiToFrequency(midi);
    const level = tone.level * (0.3 + 0.7 * (velocity / 127));

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + tone.attack);
    // a quick drop, then a long decay (higher notes fade faster), or held
    gain.gain.exponentialRampToValueAtTime(level * Math.max(0.45, tone.sustain), when + 0.25);
    gain.gain.exponentialRampToValueAtTime(
      level * Math.max(0.0001, tone.sustain),
      when + 2.5 - Math.min(1.5, midi / 80)
    );

    // the tone gets darker as it fades
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(tone.maxCutoff, frequency * tone.brightness), when);
    filter.frequency.exponentialRampToValueAtTime(
      Math.min(tone.maxCutoff / 2, frequency * (tone.brightness / 2.5)),
      when + 0.8
    );
    filter.connect(gain);
    gain.connect(master);

    // vibrato: a slow wobble of the pitch (in cents), starting after the attack
    let lfo: OscillatorNode | null = null;
    let lfoGain: GainNode | null = null;
    if (tone.vibrato) {
      lfo = context.createOscillator();
      lfo.frequency.value = 5.5;
      lfoGain = context.createGain();
      lfoGain.gain.setValueAtTime(0, when);
      lfoGain.gain.linearRampToValueAtTime(tone.vibrato, when + 0.3);
      lfo.connect(lfoGain);
      lfo.start(when);
    }

    const oscillators = tone.partials.map(([type, ratio, amount]) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency * ratio;
      if (lfoGain) lfoGain.connect(oscillator.detune);
      const partialGain = context.createGain();
      partialGain.gain.value = amount;
      oscillator.connect(partialGain);
      partialGain.connect(filter);
      oscillator.start(when);
      return oscillator;
    });
    return { gain, oscillators: lfo ? [...oscillators, lfo] : oscillators };
  }

  private release(voice: Voice, when: number) {
    voice.gain.gain.cancelScheduledValues(when);
    voice.gain.gain.setTargetAtTime(0, when, RELEASE / 4);
    voice.oscillators.forEach((oscillator) => oscillator.stop(when + RELEASE));
  }

  /** A key is pressed (the same key pressed again restarts) */
  noteOn(midi: number, velocity = 100) {
    const { context } = this.output();
    const playing = this.held.get(midi);
    if (playing) this.release(playing, context.currentTime);
    this.sustained.delete(midi);
    this.held.set(midi, this.voice(midi, velocity, context.currentTime));
  }

  /** A key is released (held on while the sustain pedal is down) */
  noteOff(midi: number) {
    if (this.pedal) {
      this.sustained.add(midi);
      return;
    }
    const voice = this.held.get(midi);
    if (!voice || !this.context) return;
    this.release(voice, this.context.currentTime);
    this.held.delete(midi);
  }

  /** The sustain pedal: released notes ring until it is lifted */
  setPedal(down: boolean) {
    this.pedal = down;
    if (!down) {
      this.sustained.forEach((midi) => this.noteOff(midi));
      this.sustained.clear();
    }
  }

  /**
   * Notes played together for a while (seconds), e.g. a chord of a song,
   * starting now or a little later (seconds)
   */
  play(
    midis: number[],
    duration: number,
    velocity = 90,
    delay = 0,
    instrument: Instrument = 'keys'
  ) {
    const { context } = this.output();
    const start = context.currentTime + Math.max(0, delay);
    midis.forEach((midi) =>
      this.release(this.voice(midi, velocity, start, instrument), start + Math.max(0.05, duration))
    );
  }

  /** A click for the beat (higher on the first beat of a bar) */
  click(accent = false) {
    const { context, master } = this.output();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(accent ? 0.12 : 0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  }

  /** Every note stops (leaving a page) */
  stopAll() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.held.forEach((voice) => this.release(voice, now));
    this.held.clear();
    this.sustained.clear();
  }
}

/** The app's built-in sound */
export const synth = new Synth();
