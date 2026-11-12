/**
 * A small built-in sound (Web Audio): a soft electric-piano-like tone for notes and chords,
 * and a click for the beat. No samples: a few oscillators with a decaying envelope.
 */

type Voice = { gain: GainNode; oscillators: OscillatorNode[] };

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

  /** A note starting at `when` (audio time): it fades like a struck string */
  private voice(midi: number, velocity: number, when: number): Voice {
    const { context, master } = this.output();
    const frequency = midiToFrequency(midi);
    const level = 0.22 * (0.3 + 0.7 * (velocity / 127));

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + 0.006);
    // a quick drop, then a long decay (higher notes fade faster)
    gain.gain.exponentialRampToValueAtTime(level * 0.45, when + 0.25);
    gain.gain.exponentialRampToValueAtTime(level * 0.05, when + 2.5 - Math.min(1.5, midi / 80));

    // the tone gets darker as it fades
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(9000, frequency * 8), when);
    filter.frequency.exponentialRampToValueAtTime(Math.min(4000, frequency * 3), when + 0.8);
    filter.connect(gain);
    gain.connect(master);

    const partials: [OscillatorType, number, number][] = [
      ['triangle', 1, 1],
      ['sine', 2, 0.35],
      ['sine', 3, 0.12],
    ];
    const oscillators = partials.map(([type, ratio, amount]) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency * ratio;
      const partialGain = context.createGain();
      partialGain.gain.value = amount;
      oscillator.connect(partialGain);
      partialGain.connect(filter);
      oscillator.start(when);
      return oscillator;
    });
    return { gain, oscillators };
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

  /** Notes played together for a while (seconds), e.g. a chord of a song */
  play(midis: number[], duration: number, velocity = 90) {
    const { context } = this.output();
    const now = context.currentTime;
    midis.forEach((midi) => this.release(this.voice(midi, velocity, now), now + duration));
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
